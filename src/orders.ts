import { randomBytes } from "node:crypto";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { AGENT, publicClient } from "./chain.js";
import { ACTIVE_CURRENCIES, CELO_TOKEN, LOCALS, PARAMS, STABLE_LIST, type CurrencyCode } from "./config.js";
import { db, save, type Order } from "./store.js";
import { localPerUsd, pairAvailable } from "./textile.js";
import { ENV } from "./config.js";

export class UserError extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

const DEAD = "0x000000000000000000000000000000000000dEaD".toLowerCase();

export function validateRecipient(raw: string): Address {
  if (!isAddress(raw, { strict: false })) throw new UserError("recipient must be a valid Celo (EVM) address");
  const a = getAddress(raw.toLowerCase());
  const bad = new Set<string>([zeroAddress, DEAD, AGENT.toLowerCase(), CELO_TOKEN.toLowerCase(),
    ...STABLE_LIST.map((s) => s.address.toLowerCase()), ...Object.values(LOCALS).map((l) => l.address.toLowerCase())]);
  if (bad.has(a.toLowerCase())) throw new UserError("that recipient address is not allowed");
  return a;
}

const open = (o: Order) => o.state === "quoted" || o.state === "payment_pending";
const fp = (n: bigint) => n.toString();

function usd24h(): number {
  const since = Date.now() - 24 * 3600_000;
  return Object.values(db.orders).filter((o) => o.createdAt > since && !["expired", "refunded"].includes(o.state)).reduce((s, o) => s + o.usd, 0);
}

export interface CreateInput { currency: string; recipient: string; usd?: number; local?: number; lang?: string; ip?: string }

export async function createOrder(inp: CreateInput): Promise<Order> {
  if (ENV.paused()) throw new UserError("Puente is paused for maintenance", 503);
  const code = String(inp.currency).toUpperCase() as CurrencyCode;
  if (!LOCALS[code]) throw new UserError("unsupported currency");
  if (!ACTIVE_CURRENCIES.includes(code) && !(await pairAvailable(code))) throw new UserError(`${code} is not available right now`);
  const recipient = validateRecipient(inp.recipient);
  const ip = inp.ip ?? "?";
  const openMine = Object.values(db.orders).filter((o) => o.ip === ip && o.state === "quoted" && o.expiresAt > Date.now()).length;
  if (openMine >= PARAMS.openUnpaidPerIp) throw new UserError("too many open quotes, pay or wait a minute", 429);

  const q = await localPerUsd(code);
  if (!q.ok) throw new UserError(`${code} liquidity unavailable (${q.reason}); try again soon`, 503);
  const rate = q.rate;

  let usd: number;
  if (inp.usd !== undefined) usd = Number(inp.usd);
  else if (inp.local !== undefined) usd = Number(inp.local) / rate;
  else throw new UserError("provide usd or local amount");
  if (!Number.isFinite(usd) || usd <= 0) throw new UserError("invalid amount");
  usd = Math.round(usd * 10000) / 10000;
  if (usd < PARAMS.orderMinUsd) throw new UserError(`minimum order is $${PARAMS.orderMinUsd} (about ${(PARAMS.orderMinUsd * rate).toFixed(0)} ${code})`);
  if (usd > PARAMS.orderMaxUsd) throw new UserError(`maximum order is $${PARAMS.orderMaxUsd} during the hackathon`);
  if (usd24h() + usd > PARAMS.dailyOutflowCapUsd) throw new UserError("daily volume cap reached, try later", 503);

  const feeUsd = Math.round(Math.max(PARAMS.feeMinUsd, usd * PARAMS.feePct) * 10000) / 10000;
  const seq = ++db.seq;
  // unique price fingerprint (<= $0.0009 extra) lets the payout worker match the onchain Transfer to exactly one order
  let atomic = BigInt(Math.ceil((usd + feeUsd) * 1e6)) + BigInt(1 + (seq % 900));
  const taken = new Set(Object.values(db.orders).filter(open).map((o) => o.priceAtomic));
  while (taken.has(fp(atomic))) atomic += 1n;

  const dp = LOCALS[code].payoutDp;
  const payoutLocal = (Math.floor(usd * rate * 10 ** dp) / 10 ** dp).toFixed(dp);
  const startBlock = ((await publicClient.getBlockNumber()) - 3n).toString();
  const lang = (["en", "es", "pt"].includes(String(inp.lang)) ? inp.lang : "en") as Order["lang"];
  const now = Date.now();
  const o: Order = {
    id: randomBytes(6).toString("hex"), seq, createdAt: now, expiresAt: now + PARAMS.quoteValiditySec * 1000,
    state: "quoted", currency: code, recipient, lang, usd, feeUsd, priceAtomic: fp(atomic), payoutLocal, rate, startBlock, ip,
  };
  db.orders[o.id] = o;
  save();
  return o;
}

export function getOrder(id: string): Order | undefined { return db.orders[id]; }

export function offrampLink(o: Order): string {
  const l = LOCALS[o.currency];
  return `https://ramp.ripio.com/offramp?country=${l.country}&chain=42220&token=${l.symbol.toUpperCase()}&amount=${o.payoutLocal}&address=${o.recipient}`;
}

const scan = (h?: string) => (h ? `https://celoscan.io/tx/${h}` : undefined);

export function publicOrder(o: Order) {
  return {
    id: o.id, state: o.state, currency: o.currency, token: LOCALS[o.currency].symbol,
    recipient: o.recipient, payoutLocal: o.payoutLocal, rate: o.rate,
    usd: o.usd, feeUsd: o.feeUsd,
    price: { usd: Number(o.priceAtomic) / 1e6, atomic: o.priceAtomic, tokens: STABLE_LIST.map((s) => s.symbol) },
    expiresAt: o.expiresAt, payer: o.payer, payToken: o.payToken,
    payTx: o.payTx, payTxUrl: scan(o.payTx), payoutTx: o.payoutTx, payoutTxUrl: scan(o.payoutTx),
    refundTx: o.refundTx, refundTxUrl: scan(o.refundTx), note: o.note,
    offrampUrl: o.state === "completed" ? offrampLink(o) : undefined,
    completedAt: o.completedAt,
  };
}
