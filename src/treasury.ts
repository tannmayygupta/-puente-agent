// Treasury agent: keeps a small float of local stablecoins so payouts are instant, and refills it from Textile
// only when the rate is good (or when it must). Every decision is logged publicly at /agent/log.
import { parseUnits, type Address } from "viem";
import { balanceOf, celoBalance, fmt, gasOpts, AGENT } from "./chain.js";
import { ACTIVE_CURRENCIES, LOCALS, PARAMS, STABLE_LIST, STABLES, type CurrencyCode } from "./config.js";
import { db, decide, save, type SwapRec } from "./store.js";
import { localPerUsd, swap, TextileError, type SwapResult } from "./textile.js";

let lock: Promise<unknown> = Promise.resolve();
/** One Textile swap at a time (Textile allows only 4 open firm quotes per key/IP). */
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

interface Pt { t: number; rate: number }
const hist: Record<string, Pt[]> = {};
const ema: Record<string, number> = {};
const lowSince: Record<string, number> = {};
const lastLogged: Record<string, number> = {};
const lastRate: Record<string, number> = {};

export function rateStats(code: CurrencyCode) {
  const h = hist[code] ?? [];
  const best = h.length ? Math.max(...h.map((p) => p.rate)) : 0;
  return { samples: h.length, best, ema: ema[code] ?? 0, last: lastRate[code] ?? 0 };
}

function throttledDecision(key: string, everyMs: number, d: Parameters<typeof decide>[0]) {
  if (Date.now() - (lastLogged[key] ?? 0) < everyMs) return;
  lastLogged[key] = Date.now();
  decide(d);
}

function recordCost(code: CurrencyCode, qty: number, usd: number) {
  const c = (db.floatCost[code] ??= { qty: 0, usd: 0 });
  c.qty += qty; c.usd += usd;
}

/** Called when a payout leaves the float: realised FX P&L = revenue at quoted rate - cost of that float. */
export function recordPayout(code: CurrencyCode, local: number, quoteRate: number) {
  const c = db.floatCost[code];
  if (!c || c.qty <= 0 || quoteRate <= 0) return;
  const take = Math.min(local, c.qty);
  const usdCost = take * (c.usd / c.qty);
  db.realizedFxPnlUsd += take / quoteRate - usdCost;
  c.qty -= take; c.usd -= usdCost;
  save();
}

function addSwapRec(kind: SwapRec["kind"], sell: Address, buy: Address, r: SwapResult, sellUsd: number, extra: Partial<SwapRec> = {}) {
  db.swaps.push({
    ts: Date.now(), rfqId: r.rfqId, kind, sell, buy,
    sellAmount: r.sold.toString(), buyAmount: r.bought.toString(), tx: r.txHash,
    sellUsd, feeUsd: fmt(r.feeAmount, 6), ...extra,
  });
  save();
}

/** Tokens we still owe back to payers (orders paid but not completed). Never convert these away. */
function liability(token: Address, exceptOrder?: string): bigint {
  return Object.values(db.orders)
    .filter((o) => o.id !== exceptOrder && o.payToken?.toLowerCase() === token.toLowerCase() && ["paid_seen", "paying_out", "refund_pending"].includes(o.state))
    .reduce((s, o) => s + BigInt(o.priceAtomic), 0n);
}

/** Textile routes through USDT. If USDT is short, convert free USDC/USAT (above our liabilities) into USDT.
 *  `ownOrder`: the order being fulfilled right now. Its own payment may be used to fund its own payout (zero-capital mode). */
async function ensureUsdt(neededUsd: number, ownOrder?: string): Promise<void> {
  let have = fmt(await balanceOf(STABLES.USDT.address), 6);
  if (have >= neededUsd) return;
  for (const s of [STABLES.USDC, STABLES.USAT]) {
    const bal = await balanceOf(s.address);
    const liab = liability(s.address, ownOrder);
    const free = bal > liab ? bal - liab : 0n;
    const want = parseUnits((neededUsd - have + 0.05).toFixed(6), 6);
    const amt = free < want ? free : want;
    if (fmt(amt, 6) < 1.05) continue; // Textile minimum firm size is about $1
    const minBuy = (amt * BigInt(10000 - PARAMS.jitSlippageBps - 10)) / 10000n;
    const r = await swap(s.address, STABLES.USDT.address, amt, { minBuy });
    addSwapRec("consolidate", s.address, STABLES.USDT.address, r, fmt(r.sold, 6));
    decide({ kind: "consolidate", pair: `${s.symbol}/USDT`, reason: `USDT was short for a refill; converted ${fmt(r.sold, 6).toFixed(2)} ${s.symbol} into USDT`, tx: r.txHash });
    have = fmt(await balanceOf(STABLES.USDT.address), 6);
    if (have >= neededUsd) return;
  }
}

async function refill(code: CurrencyCode, sizeUsd: number, rate: number, kind: "refill" | "jit", reason: string, ownOrder?: string) {
  const local = LOCALS[code];
  return exclusive(async () => {
    const gasInUsdt = (await gasOpts()).feeCurrency !== undefined;
    await ensureUsdt(sizeUsd + (gasInUsdt ? 0.2 : 0), ownOrder); // keep a little USDT only when gas is paid in USDT
    const usdtBal = fmt(await balanceOf(STABLES.USDT.address), 6);
    if (usdtBal < sizeUsd) throw new TextileError(`USDT too low for ${kind}: ${usdtBal} < ${sizeUsd}`, 0, "insufficient_funds");
    const sellAmt = parseUnits(sizeUsd.toFixed(6), 6);
    const minBuy = parseUnits((sizeUsd * rate * (1 - PARAMS.jitSlippageBps / 1e4)).toFixed(6), 18);
    const r = await swap(STABLES.USDT.address, local.address, sellAmt, { minBuy });
    const sold = fmt(r.sold, 6), bought = fmt(r.bought, 18);
    const execRate = bought / sold;
    const e = ema[code] || rate;
    const bps = ((execRate - e) / e) * 1e4;
    recordCost(code, bought, sold);
    addSwapRec(kind, STABLES.USDT.address, local.address, r, sold, { rate: execRate, bpsVsEma: bps });
    decide({ kind, pair: `USDT/${local.symbol}`, reason: `${reason}; bought ${bought.toFixed(2)} ${local.symbol} for ${sold.toFixed(4)} USDT @ ${execRate.toFixed(4)} (${bps.toFixed(1)} bps vs 30m avg)`, rate: execRate, ema: e, bpsVsBest: bps, tx: r.txHash });
    return r;
  });
}

/** Just-in-time fill when a payout finds the float empty. Strict slippage lock vs the quoted rate. */
export async function jitFill(code: CurrencyCode, neededLocal: number, lockRate: number, ownOrder?: string): Promise<void> {
  // size = exactly what the payout needs (+0.4% slippage room); Textile's minimum firm size is about $1
  const sizeUsd = Math.max(1.0, Math.ceil((neededLocal / lockRate) * 1.004 * 100) / 100);
  await refill(code, sizeUsd, lockRate, "jit", `float short for ${LOCALS[code].symbol}: needed ${neededLocal.toFixed(2)}; funded by the order's own payment`, ownOrder);
}

async function sampleAndAct(code: CurrencyCode) {
  const local = LOCALS[code];
  const pair = `USDT/${local.symbol}`;
  const r = await localPerUsd(code, 5);
  if (!r.ok) { throttledDecision(`na-${code}`, 600_000, { kind: "unavailable", pair, reason: `no quote right now (${r.reason})` }); return; }
  const now = Date.now();
  const h = (hist[code] ??= []);
  h.push({ t: now, rate: r.rate });
  while (h.length && now - h[0].t > 30 * 60_000) h.shift();
  ema[code] = ema[code] ? ema[code] * 0.8 + r.rate * 0.2 : r.rate;
  lastRate[code] = r.rate;
  const best = Math.max(...h.map((p) => p.rate));
  const bpsFromBest = ((best - r.rate) / best) * 1e4;

  const bal = fmt(await balanceOf(local.address), 18);
  const floatUsd = bal / r.rate;
  if (floatUsd >= PARAMS.floatLowUsd) {
    delete lowSince[code];
    throttledDecision(`hold-${code}`, 600_000, { kind: "hold", pair, reason: `float ${floatUsd.toFixed(2)} USD >= low-water ${PARAMS.floatLowUsd}; rate ${r.rate.toFixed(4)}, ${bpsFromBest.toFixed(1)} bps below 30m best`, rate: r.rate, ema: ema[code], bpsVsBest: bpsFromBest });
    return;
  }
  lowSince[code] ??= now;
  const waitedMin = (now - lowSince[code]) / 60_000;
  const critical = floatUsd < PARAMS.floatCriticalUsd;
  const good = h.length >= 3 && bpsFromBest <= PARAMS.guardBps;
  const stale = waitedMin >= PARAMS.maxWaitMin;
  if (!(critical || good || stale)) {
    throttledDecision(`wait-${code}`, 120_000, { kind: "wait", pair, reason: `float ${floatUsd.toFixed(2)} < ${PARAMS.floatLowUsd} but rate is ${bpsFromBest.toFixed(1)} bps below 30m best (guard ${PARAMS.guardBps}); waiting (${waitedMin.toFixed(0)} min)`, rate: r.rate, ema: ema[code], bpsVsBest: bpsFromBest });
    return;
  }
  // exposure cap across all local floats
  let total = 0;
  for (const c of ACTIVE_CURRENCIES) {
    const lr = lastRate[c]; if (!lr) continue;
    total += fmt(await balanceOf(LOCALS[c].address), 18) / lr;
  }
  const want = Math.min(PARAMS.floatTargetUsd - floatUsd, PARAMS.floatCapUsd - floatUsd, PARAMS.totalFloatCapUsd - total);
  if (want < PARAMS.refillMinUsd) { throttledDecision(`cap-${code}`, 300_000, { kind: "skip", pair, reason: `refill size ${want.toFixed(2)} below minimum ${PARAMS.refillMinUsd} or exposure cap reached (total float ${total.toFixed(2)})` }); return; }
  const why = critical ? "float critical" : good ? `rate within ${PARAMS.guardBps} bps of 30m best` : `waited ${waitedMin.toFixed(0)} min`;
  await refill(code, Math.floor(want * 100) / 100, r.rate, "refill", `${why}; float was ${floatUsd.toFixed(2)} USD`);
  delete lowSince[code];
}

/** Convert collected USAT/USDC (from completed orders only) into USDT, in batches. */
async function consolidate() {
  for (const s of [STABLES.USAT, STABLES.USDC]) {
    const pending = BigInt(db.pendingConsolidate[s.address] ?? "0");
    if (pending <= 0n || fmt(pending, 6) < PARAMS.consolidateMinUsd) continue;
    const bal = await balanceOf(s.address);
    const amount = pending < bal ? pending : bal;
    if (amount <= 0n || fmt(amount, 6) < PARAMS.consolidateMinUsd) continue;
    try {
      await exclusive(async () => {
        const minBuy = (amount * BigInt(10000 - PARAMS.jitSlippageBps - 10)) / 10000n;
        const r = await swap(s.address, STABLES.USDT.address, amount, { minBuy });
        addSwapRec("consolidate", s.address, STABLES.USDT.address, r, fmt(r.sold, 6));
        db.pendingConsolidate[s.address] = (pending - amount).toString();
        decide({ kind: "consolidate", pair: `${s.symbol}/USDT`, reason: `converted ${fmt(r.sold, 6).toFixed(2)} ${s.symbol} collected from completed orders into USDT`, tx: r.txHash });
      });
    } catch (e) {
      decide({ kind: "error", pair: `${s.symbol}/USDT`, reason: `consolidation failed: ${(e as Error).message.slice(0, 160)}` });
    }
  }
}

let running = false;
export async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const c of ACTIVE_CURRENCIES) {
      try { await sampleAndAct(c); } catch (e) { throttledDecision(`err-${c}`, 300_000, { kind: "error", pair: c, reason: (e as Error).message.slice(0, 200) }); }
    }
    await consolidate();
  } finally { running = false; }
}

export function startTreasury(intervalMs = 30_000) {
  if (process.env.TREASURY_AUTO === "0") { console.log("[treasury] auto loop disabled (TREASURY_AUTO=0)"); return; }
  setTimeout(() => void tick(), 2_000);
  setInterval(() => void tick(), intervalMs);
}

export async function snapshot() {
  const out: Record<string, { amount: number; usd: number }> = {};
  for (const c of ACTIVE_CURRENCIES) {
    const amt = fmt(await balanceOf(LOCALS[c].address), 18);
    const r = lastRate[c];
    out[LOCALS[c].symbol] = { amount: amt, usd: r ? amt / r : NaN };
  }
  for (const s of STABLE_LIST) { const a = fmt(await balanceOf(s.address), 6); out[s.symbol] = { amount: a, usd: a }; }
  out.CELO = { amount: fmt(await celoBalance(), 18), usd: NaN };
  return { wallet: AGENT, balances: out };
}
