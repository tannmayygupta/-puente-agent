// Payout worker. It NEVER trusts the HTTP handler: it pays out only after it SEES the payer's Transfer onchain.
import { getAddress, parseUnits } from "viem";
import { balanceOf, fmt, incomingTransfers, publicClient, sendTransfer } from "./chain.js";
import { DRY_RUN, LOCALS, PARAMS, STABLES, STABLE_LIST } from "./config.js";
import { db, decide, save, saveNow, type Order } from "./store.js";
import { jitFill, recordPayout } from "./treasury.js";
import { afterPayoutChecks, beforePayoutChecks } from "./buy.js";

const attempts = new Map<string, { n: number; next: number }>();
const busy = new Set<string>();

function liveOrders(): Order[] {
  const now = Date.now();
  return Object.values(db.orders).filter((o) =>
    (o.state === "quoted" || o.state === "payment_pending") && now <= o.expiresAt + PARAMS.payerWaitSec * 1000);
}

async function matchPayments(): Promise<void> {
  const pending = liveOrders();
  if (!pending.length) return;
  const minBlock = pending.reduce((m, o) => (BigInt(o.startBlock) < m ? BigInt(o.startBlock) : m), BigInt(pending[0].startBlock));
  for (const s of STABLE_LIST) {
    const logs = await incomingTransfers(s.address, minBlock);
    for (const l of logs) {
      const key = `${l.transactionHash}:${l.logIndex}`;
      if (db.usedLogs[key]) continue;
      const o = pending.find((p) => p.priceAtomic === String(l.args.value) && BigInt(p.startBlock) <= (l.blockNumber ?? 0n));
      if (!o) continue;
      db.usedLogs[key] = o.id;
      o.state = "paid_seen";
      o.payer = l.args.from as string;
      o.payToken = s.address;
      o.payTx = l.transactionHash;
      o.payLogKey = key;
      saveNow();
      decide({ kind: "payment_seen", pair: s.symbol, reason: `order ${o.id}: ${fmt(BigInt(o.priceAtomic), 6).toFixed(6)} ${s.symbol} from ${o.payer} confirmed onchain`, tx: l.transactionHash });
    }
  }
}

async function refund(o: Order, why: string): Promise<void> {
  if (!o.payer || !o.payToken) { o.state = "needs_manual"; o.note = `no payer to refund: ${why}`; save(); return; }
  o.state = "refund_pending"; save();
  try {
    // refund in the same token when we still hold it; if the payment was converted to fund the swap, refund the same USD amount in USDT
    // 1) same token if we still hold it, 2) USDT if the payment was converted for the swap,
    // 3) the local currency itself if the swap already happened but the payout transfer failed (value-preserving)
    let token = getAddress(o.payToken);
    let amount = BigInt(o.priceAtomic);
    let how = "";
    if ((await balanceOf(token)) < amount) {
      if ((await balanceOf(STABLES.USDT.address)) >= amount) { token = STABLES.USDT.address; how = " in USDT"; }
      else {
        const local = LOCALS[o.currency];
        const la = parseUnits(o.payoutLocal, 18);
        if ((await balanceOf(local.address)) < la) throw new Error("no funds available to refund (needs manual review)");
        token = local.address; amount = la; how = ` in ${local.symbol} (the payment had already been swapped)`;
      }
    }
    const sent = await sendTransfer(token, getAddress(o.payer), amount, `refund-${o.id}`);
    const sym = [...Object.values(STABLES), ...Object.values(LOCALS)].find((t) => t.address.toLowerCase() === token.toLowerCase())?.symbol ?? token;
    o.refundTx = sent.hash; o.state = "refunded"; o.note = `refunded${how}: ${why}`; saveNow();
    decide({ kind: "refund", reason: `order ${o.id} refunded in ${sym}: ${why}`, tx: sent.hash });
  } catch (e) {
    o.state = "needs_manual"; o.note = `refund failed: ${(e as Error).message.slice(0, 160)}`; saveNow();
    decide({ kind: "error", reason: `order ${o.id} needs manual refund: ${(e as Error).message.slice(0, 160)}` });
  }
}

async function runPayout(o: Order): Promise<void> {
  const local = LOCALS[o.currency];
  const amount = parseUnits(o.payoutLocal, 18);
  o.state = "paying_out"; save();
  if (DRY_RUN) {
    o.state = "completed"; o.completedAt = Date.now();
    o.note = "DRY RUN: payment confirmed onchain; swap and payout skipped (test only)";
    saveNow();
    decide({ kind: "dry_run", pair: local.symbol, reason: `order ${o.id}: payment matched onchain; payout skipped (DRY_RUN)`, tx: o.payTx });
    return;
  }
  try {
    await beforePayoutChecks(o).catch((e) => decide({ kind: "note", reason: `pre-check skipped: ${(e as Error).message.slice(0, 100)}` }));
    let bal = await balanceOf(local.address);
    if (bal < amount) {
      decide({ kind: "float_short", pair: local.symbol, reason: `order ${o.id} needs ${o.payoutLocal} but float is ${fmt(bal, 18).toFixed(2)}; filling just-in-time` });
      await jitFill(o.currency, Number(o.payoutLocal), o.rate, o.id);
      bal = await balanceOf(local.address);
      if (bal < amount) throw new Error("float still short after JIT fill");
    }
    const sent = await sendTransfer(local.address, getAddress(o.recipient), amount, `payout-${o.id}`);
    o.payoutTx = sent.hash;
    o.state = "completed";
    o.completedAt = Date.now();
    if (o.payToken && o.payToken !== STABLES.USDT.address) {
      // credit only what we still hold: a payment that was already converted to fund its own swap is not "waiting"
      const held = await balanceOf(getAddress(o.payToken));
      const next = BigInt(db.pendingConsolidate[o.payToken] ?? "0") + BigInt(o.priceAtomic);
      db.pendingConsolidate[o.payToken] = (next < held ? next : held).toString();
    }
    recordPayout(o.currency, Number(o.payoutLocal), o.rate);
    saveNow();
    decide({ kind: "payout", pair: local.symbol, reason: `order ${o.id}: sent ${o.payoutLocal} ${local.symbol} to ${o.recipient} from float`, tx: sent.hash });
    afterPayoutChecks(o).catch(() => {});
  } catch (e) {
    const a = attempts.get(o.id) ?? { n: 0, next: 0 };
    a.n++; a.next = Date.now() + Number(process.env.PAYOUT_RETRY_MS ?? 10_000); attempts.set(o.id, a);
    o.note = `payout attempt ${a.n} failed: ${(e as Error).message.slice(0, 140)}`;
    if (a.n >= 3) { await refund(o, "payout failed 3 times"); return; }
    o.state = "paid_seen"; save();
  }
}

function expireOld(): void {
  const now = Date.now();
  for (const o of Object.values(db.orders)) {
    if ((o.state === "quoted" || o.state === "payment_pending") && now > o.expiresAt + PARAMS.payerWaitSec * 1000) { o.state = "expired"; save(); }
  }
}

let ticking = false;
export async function payoutTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    expireOld();
    await matchPayments();
    for (const o of Object.values(db.orders)) {
      if (o.state !== "paid_seen" || busy.has(o.id)) continue;
      if ((attempts.get(o.id)?.next ?? 0) > Date.now()) continue;
      busy.add(o.id);
      void runPayout(o).finally(() => busy.delete(o.id));
    }
  } catch (e) {
    console.error("[payout] tick error:", (e as Error).message);
  } finally { ticking = false; }
}

export function startPayoutWorker(ms = 2500) {
  setInterval(() => void payoutTick(), ms);
}

void publicClient;
