// Textile FX v2 RFQ client (https://docs.textilecredit.com/api/v2/rfq). Keyless: firm quotes are authorised by
// a takerProof signature from our wallet, produced only when the venue answers 401 proof_of_control_*.
import { randomBytes } from "node:crypto";
import { getAddress, parseUnits, toHex, type Address, type Hex } from "viem";
import { account, AGENT, allowanceOf, balanceOf, fmt, publicClient, sendApprove, sendRaw } from "./chain.js";
import { CHAIN_ID, ENV, PARAMS, STABLES, TEXTILE_REACTOR, LOCALS, type CurrencyCode } from "./config.js";
import { db } from "./store.js";

const BASE = process.env.TEXTILE_BASE ?? "https://api.textilecredit.com/v2";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TextileError extends Error {
  constructor(msg: string, public status = 0, public reason?: string, public retryable = false) { super(msg); }
}

// ---- request budget: stay under Textile's 60 req/min (we cap at 50) ----
const stamps: number[] = [];
async function takeToken(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > 60_000) stamps.shift();
    if (stamps.length < 50) { stamps.push(now); return; }
    await sleep(500);
  }
}

async function call(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = 20_000) {
  await takeToken();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const key = process.env.TEXTILE_API_KEY;
    const res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: any = undefined;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, json, text };
  } finally { clearTimeout(t); }
}

// ---------------- previews (indicative, free, cached 15s) ----------------
export interface Preview { ok: boolean; buyAmount: bigint; feeAmount: bigint; reason?: string; availableSell?: bigint }
const pcache = new Map<string, { t: number; v: Preview }>();

export async function preview(sell: Address, buy: Address, sellAmount: bigint, maxAgeMs = 15_000): Promise<Preview> {
  const k = `${sell}:${buy}:${sellAmount}`;
  const hit = pcache.get(k);
  if (hit && Date.now() - hit.t < maxAgeMs) return hit.v;
  const r = await call("POST", "/rfq/preview", { chainId: CHAIN_ID, sellToken: sell, buyToken: buy, sellAmount: sellAmount.toString() });
  const d = r.json?.data;
  let v: Preview;
  if (r.status === 200 && d?.status === "preview") {
    v = { ok: true, buyAmount: BigInt(d.buyAmount), feeAmount: BigInt(d.feeAmount ?? 0), availableSell: d.availableSellAmount ? BigInt(d.availableSellAmount) : undefined };
  } else if (r.status === 200) {
    v = { ok: false, buyAmount: 0n, feeAmount: 0n, reason: d?.reason ?? d?.status ?? "no_quote" };
  } else {
    throw new TextileError(`preview HTTP ${r.status}: ${r.text.slice(0, 200)}`, r.status, r.json?.error?.details?.reason, r.status >= 429);
  }
  pcache.set(k, { t: Date.now(), v });
  db.quotesServed++;
  return v;
}

/** Local units received per 1 USD (USDT) when buying a local stablecoin. Includes Textile's fee + spread. */
export async function localPerUsd(code: CurrencyCode, usd = 5): Promise<{ ok: boolean; rate: number; reason?: string }> {
  const local = LOCALS[code];
  const p = await preview(STABLES.USDT.address, local.address, parseUnits(String(usd), 6));
  if (!p.ok) return { ok: false, rate: 0, reason: p.reason };
  db.previewQuoteVolumeUsd += usd;
  return { ok: true, rate: fmt(p.buyAmount, 18) / usd };
}

// ---------------- proof of control (EIP-712 TakerControl) ----------------
async function signTakerProof() {
  const nonce = toHex(randomBytes(32));
  const issuedAt = Date.now();
  const signature = await account.signTypedData({
    domain: { name: "Textile Taker Control", version: "1", chainId: CHAIN_ID },
    types: {
      TakerControl: [
        { name: "taker", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "issuedAt", type: "uint256" },
      ],
    },
    primaryType: "TakerControl",
    message: { taker: AGENT, chainId: BigInt(CHAIN_ID), nonce, issuedAt: BigInt(issuedAt) },
  });
  return { nonce, issuedAt, signature };
}

export interface FirmQuote {
  rfqId: string;
  claimToken: string;
  takerPays: bigint;
  buyAmount: bigint;
  feeAmount: bigint;
  expiresAt: number;
  reactor: Address;
  swap: { to: Address; data: Hex; value: bigint };
  approval?: { to: Address; data: Hex; value: bigint } | null;
  raw?: any;
}

export async function requestFirm(sell: Address, buy: Address, sellAmount: bigint): Promise<FirmQuote> {
  let proof: Awaited<ReturnType<typeof signTakerProof>> | undefined;
  let withAttr = true;
  for (let attempt = 0; attempt < 4; attempt++) {
    const body: Record<string, unknown> = {
      chainId: CHAIN_ID, sellToken: sell, buyToken: buy, sellAmount: sellAmount.toString(), taker: AGENT,
    };
    if (withAttr) { body.includeAttribution = true; body.builderCodes = [ENV.attribution]; }
    if (proof) body.takerProof = proof;
    db.firmQuotesRequested++;
    const r = await call("POST", "/rfq/request", body, {}, 75_000);
    const err = r.json?.error;
    if (r.status === 401 && String(err?.details?.reason ?? "").startsWith("proof_of_control")) {
      proof = await signTakerProof();
      continue;
    }
    if (r.status === 400 && withAttr && /attribution|builderCodes/i.test(JSON.stringify(err ?? r.text))) {
      withAttr = false; // our wallet client still tags the swap tx itself
      continue;
    }
    if (r.status === 429) throw new TextileError(`rate/slot limited: ${err?.message ?? r.text.slice(0, 150)}`, 429, "rate_limited", true);
    if (r.status >= 500) throw new TextileError(`venue error ${r.status}`, r.status, err?.code, true);
    if (r.status !== 200) throw new TextileError(`request failed ${r.status}: ${JSON.stringify(err ?? r.text).slice(0, 300)}`, r.status, err?.details?.reason);
    const d = r.json.data;
    if (d.status !== "quoted") throw new TextileError(`no quote: ${d.reason ?? d.status}`, 200, d.reason, d.reason === "no_valid_quote");
    const q = d.quote, tx = d.transactions?.swap;
    if (!q || !tx) throw new TextileError("quote missing fields");
    return {
      rfqId: d.rfqId,
      claimToken: d.claimToken,
      takerPays: BigInt(q.takerPays),
      buyAmount: BigInt(q.buyAmount),
      feeAmount: BigInt(q.feeAmount ?? 0),
      expiresAt: new Date(q.expiresAt).getTime(),
      reactor: getAddress(q.reactor ?? TEXTILE_REACTOR),
      swap: { to: getAddress(tx.to), data: tx.data as Hex, value: BigInt(tx.value ?? "0") },
      approval: d.transactions?.approval ? { to: getAddress(d.transactions.approval.to), data: d.transactions.approval.data as Hex, value: BigInt(d.transactions.approval.value ?? "0") } : null,
      raw: d,
    };
  }
  throw new TextileError("could not obtain firm quote (proof loop)");
}

async function submit(rfqId: string, claim: string, txHash: string) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await call("POST", `/rfq/${rfqId}/submit`, { txHash }, { "x-rfq-claim": claim });
      if (r.status < 300 || r.status === 409) return;
    } catch { /* retry */ }
    await sleep(1500);
  }
}

/** Approve the reactor once (capped) so firm quotes never wait on approvals. */
export async function ensureAllowance(token: Address, needed: bigint, spender: Address = TEXTILE_REACTOR): Promise<void> {
  const cur = await allowanceOf(token, spender);
  if (cur >= needed) return;
  const isStable = Object.values(STABLES).some((s) => s.address === token);
  if (cur > 0n && token === STABLES.USDT.address) await sendApprove(token, spender, 0n, "approve-reset");
  const cap = isStable ? parseUnits(String(PARAMS.approvalCapUsd), 6) : needed;
  await sendApprove(token, spender, cap > needed ? cap : needed, "approve");
  // RPC nodes can lag a block or two: wait until the new allowance is actually visible, then wait a bit more
  for (let i = 0; i < 20; i++) { if ((await allowanceOf(token, spender)) >= needed) break; await sleep(1000); }
  await sleep(2500); // the swap must not land in the same block as the approval
}

export interface SwapResult { rfqId: string; txHash: Hex; sold: bigint; bought: bigint; feeAmount: bigint }

/**
 * Full firm swap: allowance -> firm quote (proof if asked) -> optional price check -> broadcast tagged swap -> report.
 * `minBuy`: if the quote delivers less, we do NOT execute (it lapses unused).
 */
export async function swap(sell: Address, buy: Address, sellAmount: bigint, opts: { minBuy?: bigint } = {}): Promise<SwapResult> {
  const held = await balanceOf(sell);
  if (held < sellAmount) throw new TextileError(`insufficient ${sell} balance: have ${held}, need ${sellAmount}`, 0, "insufficient_funds");
  await ensureAllowance(sell, sellAmount);
  const q = await requestFirm(sell, buy, sellAmount);
  if (q.reactor !== TEXTILE_REACTOR) await ensureAllowance(sell, q.takerPays, q.reactor);
  if (opts.minBuy !== undefined && q.buyAmount < opts.minBuy) {
    throw new TextileError(`quote below limit: ${q.buyAmount} < ${opts.minBuy}`, 0, "below_limit");
  }
  if (q.expiresAt - Date.now() < 4000) throw new TextileError("quote expired before broadcast", 0, "expired", true);
  // dry-run the exact swap first; retry briefly while the chain state settles (never broadcast a reverting tx)
  for (let i = 0; ; i++) {
    try { await publicClient.call({ account: AGENT, to: q.swap.to, data: q.swap.data, value: q.swap.value }); break; }
    catch (e) {
      if (i >= 8 || q.expiresAt - Date.now() < 5000) throw new TextileError(`swap simulation failed: ${(e as Error).message.split("\n")[0].slice(0, 160)}`, 0, "sim_failed", true);
      await sleep(1500);
    }
  }
  const sent = await sendRaw(q.swap, "textile-swap");
  await submit(q.rfqId, q.claimToken, sent.hash);
  return { rfqId: q.rfqId, txHash: sent.hash, sold: q.takerPays, bought: q.buyAmount, feeAmount: q.feeAmount };
}

export async function pairAvailable(code: CurrencyCode): Promise<boolean> {
  try { return (await localPerUsd(code, 2)).ok; } catch { return false; }
}
