// Tiny durable JSON store (single process). Atomic writes. Mount DATA_DIR on a volume in production.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENV } from "./config.js";

export type OrderState =
  | "quoted" | "payment_pending" | "paid_seen" | "paying_out" | "completed"
  | "refund_pending" | "refunded" | "expired" | "needs_manual";

export interface Order {
  id: string;
  seq: number;
  createdAt: number;
  expiresAt: number;
  state: OrderState;
  currency: "ARS" | "BRL" | "COP" | "MXN";
  recipient: string;
  lang: "en" | "es" | "pt";
  usd: number; // value delivered (before fee)
  feeUsd: number;
  priceAtomic: string; // 6-dec atomic amount payer must send (unique fingerprint)
  payoutLocal: string; // decimal string, e.g. "8258.34"
  rate: number; // local per USD at quote time
  startBlock: string;
  ip?: string;
  // payment
  payer?: string;
  payToken?: string;
  payTx?: string;
  payLogKey?: string;
  // payout
  payoutTx?: string;
  refundTx?: string;
  completedAt?: number;
  note?: string;
  receipt?: Record<string, unknown>;
  consolidated?: boolean;
}

export interface Decision { ts: number; kind: string; pair?: string; reason: string; rate?: number; ema?: number; bpsVsBest?: number; tx?: string }
export interface SwapRec { ts: number; rfqId: string; kind: "refill" | "consolidate" | "jit" | "rebalance"; sell: string; buy: string; sellAmount: string; buyAmount: string; tx: string; sellUsd: number; feeUsd: number; rate?: number; bpsVsEma?: number }
export interface BuyPay { ts: number; service: string; usd: number; settleTx?: string; ok: boolean; note?: string }
export interface Quote { ts: number; pair: string; sellUsd: number; rate: number; status: string }

export interface DB {
  seq: number;
  orders: Record<string, Order>;
  decisions: Decision[];
  swaps: SwapRec[];
  buyPayments: BuyPay[];
  usedLogs: Record<string, string>;
  pendingConsolidate: Record<string, string>; // token address -> atomic amount awaiting consolidation
  quotesServed: number;
  firmQuotesRequested: number;
  previewQuoteVolumeUsd: number;
  floatCost: Record<string, { qty: number; usd: number }>; // per currency: local units held and USD paid for them
  realizedFxPnlUsd: number;
  agentId?: string;
}

const file = join(ENV.dataDir, "state.json");
if (!existsSync(ENV.dataDir)) mkdirSync(ENV.dataDir, { recursive: true });

const empty = (): DB => ({
  seq: 0, orders: {}, decisions: [], swaps: [], buyPayments: [], usedLogs: {},
  pendingConsolidate: {}, quotesServed: 0, firmQuotesRequested: 0, previewQuoteVolumeUsd: 0,
  floatCost: {}, realizedFxPnlUsd: 0,
});

export const db: DB = existsSync(file) ? { ...empty(), ...JSON.parse(readFileSync(file, "utf8")) } : empty();
if (process.env.AGENT_ID) db.agentId = process.env.AGENT_ID;

let timer: NodeJS.Timeout | null = null;
export function save(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, file);
  }, 150);
}
export function saveNow(): void {
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(db));
  renameSync(tmp, file);
}

// never lose recorded state: flush on exit and on host shutdown (Railway sends SIGTERM on redeploy)
process.on("exit", () => { try { saveNow(); } catch { /* ignore */ } });
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { try { saveNow(); } catch { /* ignore */ } process.exit(0); });

export function decide(d: Omit<Decision, "ts">): void {
  db.decisions.push({ ts: Date.now(), ...d });
  if (db.decisions.length > 2000) db.decisions.splice(0, db.decisions.length - 2000);
  console.log(`[decision] ${d.kind} ${d.pair ?? ""} ${d.reason}`);
  save();
}
