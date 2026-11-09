// In-memory simulated chain + Textile venue. Active ONLY when SIM=1 (tests). Production never sets it.
// It lets the real order / payout / refund / treasury code run end to end without real money.
import { getAddress, type Address, type Hex } from "viem";
import { CELO_TOKEN, LOCALS, STABLES, type CurrencyCode } from "./config.js";

export const SIM = process.env.SIM === "1";

export interface SimLog { address: Address; transactionHash: Hex; logIndex: number; blockNumber: bigint; args: { from: Address; to: Address; value: bigint } }

const DEFAULT_RATES: Record<CurrencyCode, number> = { ARS: 1650, BRL: 5.6, COP: 3230, MXN: 0 };

class SimChain {
  block = 1000n;
  private n = 0;
  private bal = new Map<string, bigint>();
  allow = new Map<string, bigint>();
  logs: SimLog[] = [];
  failTransfersTo = new Set<string>();
  failSwaps = 0;
  rates: Record<CurrencyCode, number> = { ...DEFAULT_RATES };

  reset() {
    this.block = 1000n; this.n = 0; this.bal.clear(); this.allow.clear(); this.logs = [];
    this.failTransfersTo.clear(); this.failSwaps = 0; this.rates = { ...DEFAULT_RATES };
  }
  private k(t: string, a: string) { return `${t.toLowerCase()}|${a.toLowerCase()}`; }
  get(t: string, a: string): bigint { return this.bal.get(this.k(t, a)) ?? 0n; }
  credit(t: string, a: string, amt: bigint) { this.bal.set(this.k(t, a), this.get(t, a) + amt); }
  debit(t: string, a: string, amt: bigint) {
    const cur = this.get(t, a);
    if (cur < amt) throw new Error(`sim: insufficient balance ${cur} < ${amt}`);
    this.bal.set(this.k(t, a), cur - amt);
  }
  hash(): Hex { return `0x${(++this.n).toString(16).padStart(64, "0")}` as Hex; }
  transfer(token: string, from: string, to: string, amt: bigint): Hex {
    if (this.failTransfersTo.has(to.toLowerCase())) throw new Error("sim: transfer reverted");
    this.debit(token, from, amt);
    this.credit(token, to, amt);
    this.block += 1n;
    const h = this.hash();
    this.logs.push({ address: getAddress(token), transactionHash: h, logIndex: 0, blockNumber: this.block, args: { from: getAddress(from), to: getAddress(to), value: amt } });
    return h;
  }
}
export const sim = new SimChain();

const FEE_BPS = 7; // simulated all-in cost (fee + spread) of 0.07%

export interface SimPreview { ok: boolean; buyAmount: bigint; reason?: string }

/** Deterministic Textile-like quote from sim.rates. Mirrors the corridors we use: USDT<->local, USAT/USDC->USDT. */
export function simPreview(sell: Address, buy: Address, sellAmount: bigint): SimPreview {
  const s = sell.toLowerCase(), b = buy.toLowerCase();
  const usdt = STABLES.USDT.address.toLowerCase();
  const localByAddr = (a: string) => Object.values(LOCALS).find((l) => l.address.toLowerCase() === a);
  if (b === usdt && (s === STABLES.USAT.address.toLowerCase() || s === STABLES.USDC.address.toLowerCase())) {
    return { ok: true, buyAmount: (sellAmount * 9995n) / 10000n };
  }
  if (s === CELO_TOKEN.toLowerCase() && b === usdt) return { ok: true, buyAmount: sellAmount / 10n ** 12n / 16n };
  const buyLocal = localByAddr(b);
  if (s === usdt && buyLocal) {
    const rate = sim.rates[buyLocal.code];
    if (!rate) return { ok: false, buyAmount: 0n, reason: "no_makers_online" };
    const usd = Number(sellAmount) / 1e6;
    return { ok: true, buyAmount: BigInt(Math.floor(usd * rate * (1 - FEE_BPS / 1e4) * 1e6)) * 10n ** 12n };
  }
  const sellLocal = localByAddr(s);
  if (b === usdt && sellLocal) {
    const rate = sim.rates[sellLocal.code];
    if (!rate) return { ok: false, buyAmount: 0n, reason: "no_makers_online" };
    const local = Number(sellAmount / 10n ** 12n) / 1e6;
    return { ok: true, buyAmount: BigInt(Math.floor((local / rate) * (1 - FEE_BPS / 1e4) * 1e6)) };
  }
  return { ok: false, buyAmount: 0n, reason: "corridor_unavailable" };
}
