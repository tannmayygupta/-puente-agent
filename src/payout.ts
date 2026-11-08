// Payout worker. It NEVER trusts the HTTP handler: it pays out only after it SEES the payer's Transfer onchain.
import { getAddress, parseUnits } from "viem";
import { balanceOf, fmt, incomingTransfers, publicClient, sendTransfer } from "./chain.js";
import { LOCALS, PARAMS, STABLES, STABLE_LIST } from "./config.js";
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
    const sent = await sendTransfer(getAddress(o.payToken), getAddress(o.payer), BigInt(o.priceAtomic), `refund-${o.id}`);
    o.refundTx = sent.hash; o.state = "refunded"; o.note = `refunded: ${why}`; saveNow();
    decide({ kind: "refund", reason: `order ${o.id} refunded in ${o.payToken}: ${why}`, tx: sent.hash });
  } catch (e) {
    o.state = "needs_manual"; o.note = `refund failed: ${(e as Error).message.slice(0, 160)}`; saveNow();
    decide({ kind: "error", reason: `order ${o.id} needs manual refund: ${(e as Error).message.slice(0, 160)}` });
  }
}

async function runPayout(o: Order): Promise<void> {
  const local = LOCALS[o.currency];
  const amount = parseUnits(o.payoutLocal, 18);
  o.state = "paying_out"; save();
  try {
    await beforePayoutChecks(o).catch((e) => decide({ kind: "note", reason: `pre-check skipped: ${(e as Error).message.slice(0, 100)}` }));
    let bal = await balanceOf(local.address);
    if (bal < amount) {
      decide({ kind: "float_short", pair: local.symbol, reason: `order ${o.id} needs ${o.payoutLocal} but float is ${fmt(bal, 18).toFixed(2)}; filling just-in-time` });
      await jitFill(o.currency, Number(o.payoutLocal), o.rate);
      bal = await balanceOf(local.address);
      if (bal < amount) throw new Error("float still short after JIT fill");
    }
    const sent = await sendTransfer(local.address, getAddress(o.recipient), amount, `payout-${o.id}`);
    o.payoutTx = sent.hash;
    o.state = "completed";
    o.completedAt = Date.now();
    if (o.payToken && o.payToken !== STABLES.USDT.address) {
      db.pendingConsolidate[o.payToken] = (BigInt(db.pendingConsolidate[o.payToken] ?? "0") + BigInt(o.priceAtomic)).toString();
    }
    recordPayout(o.currency, Number(o.payoutLocal), o.rate);
    saveNow();
    decide({ kind: "payout", pair: local.symbol, reason: `order ${o.id}: sent ${o.payoutLocal} ${local.symbol} to ${o.recipient} from float`, tx: sent.hash });
    afterPayoutChecks(o).catch(() => {});
  } catch (e) {
    const a = attempts.get(o.id) ?? { n: 0, next: 0 };
    a.n++; a.next = Date.now() + 10_000; attempts.set(o.id, a);
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
