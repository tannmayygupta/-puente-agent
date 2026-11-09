// "Build with buy": Puente PAYS for services it does not own, from wallet T, through the buy gateway (x402 on Celo).
// - Chainstack Celo RPC (one batched JSON-RPC call = $0.01): pre/post payout checks and float reads
// - Cencori LLM ($0.01): turns natural-language instructions into an order and writes localized receipts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { account, AGENT } from "./chain.js";
import { SIM } from "./sim.js";
import { ENV, LOCALS, STABLES } from "./config.js";
import { db, save, type Order } from "./store.js";

const GATEWAY = process.env.BUY_GATEWAY ?? "https://gateway.usebuy.ai";
const maxDaily = () => Number(process.env.BUY_MAX_USD_PER_DAY ?? 3);
const PER_CALL_USD = 0.02;

const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(account, { rpcUrl: ENV.rpcUrl }));
client.setSpendControls({ maxAmountPerPayment: `$${PER_CALL_USD}`, allowedAssets: true } as never);
// pay with USDT when offered (our working capital), else whatever the service accepts
client.registerPolicy((_v, reqs) => {
  const usdt = reqs.filter((r) => String((r as { asset?: string }).asset).toLowerCase() === STABLES.USDT.address.toLowerCase());
  return usdt.length ? usdt : reqs;
});
const payFetch = wrapFetchWithPayment(fetch, client);

function spentToday(): number {
  const since = Date.now() - 24 * 3600_000;
  return db.buyPayments.filter((p) => p.ts > since && p.ok).reduce((s, p) => s + p.usd, 0);
}

function settleTxFrom(res: Response): string | undefined {
  const h = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  if (!h) return undefined;
  try { return JSON.parse(Buffer.from(h, "base64").toString("utf8")).transaction; } catch { return undefined; }
}

async function paid(service: string, path: string, body: unknown, usd: number): Promise<any> {
  if (process.env.BUY_DISABLED === "1") throw new Error("buy disabled");
  if (spentToday() + usd > maxDaily()) throw new Error("daily buy budget reached");
  if (SIM) { // simulated gateway (tests only): same bookkeeping, no network, fake settlement hash
    db.buyPayments.push({ ts: Date.now(), service, usd, settleTx: `sim-${db.buyPayments.length + 1}`, ok: true }); save();
    return Array.isArray(body)
      ? (body as { id: number; method: string }[]).map((b) => ({ jsonrpc: "2.0", id: b.id, result: b.method === "eth_getCode" ? "0x" : b.method === "eth_getTransactionCount" ? "0x5" : "0x1" }))
      : { choices: [{ message: { content: "{}" } }] };
  }
  try {
    const res = await payFetch(GATEWAY + path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const settleTx = settleTxFrom(res);
    if (!res.ok) {
      db.buyPayments.push({ ts: Date.now(), service, usd: settleTx ? usd : 0, settleTx, ok: false, note: `HTTP ${res.status}` });
      save();
      throw new Error(`${service} HTTP ${res.status}`);
    }
    db.buyPayments.push({ ts: Date.now(), service, usd, settleTx, ok: true });
    save();
    return await res.json();
  } catch (e) {
    if (!/HTTP \d+/.test((e as Error).message)) {
      db.buyPayments.push({ ts: Date.now(), service, usd: 0, ok: false, note: (e as Error).message.slice(0, 120) });
      save();
    }
    throw e;
  }
}

/** One paid Chainstack batch (up to 2000 JSON-RPC calls for $0.01). */
export function rpcBatch(calls: { method: string; params: unknown[] }[]): Promise<any[]> {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, method: c.method, params: c.params }));
  return paid("chainstack.celo", "/chainstack/celo", body, 0.01);
}

export async function beforePayoutChecks(o: Order): Promise<void> {
  const local = LOCALS[o.currency];
  const bal = "0x70a08231" + AGENT.slice(2).toLowerCase().padStart(64, "0");
  const res = await rpcBatch([
    { method: "eth_getCode", params: [o.recipient, "latest"] },
    { method: "eth_getTransactionCount", params: [o.recipient, "latest"] },
    { method: "eth_call", params: [{ to: local.address, data: bal }, "latest"] },
    { method: "eth_blockNumber", params: [] },
  ]);
  const isContract = res?.[0]?.result && res[0].result !== "0x";
  const nonce = res?.[1]?.result ? parseInt(res[1].result, 16) : 0;
  o.note = `pre-check via buy/Chainstack: recipient ${isContract ? "is a contract" : "is an EOA"}, nonce ${nonce}`;
  save();
}

export async function afterPayoutChecks(o: Order): Promise<void> {
  if (!o.payoutTx) return;
  const res = await rpcBatch([{ method: "eth_getTransactionReceipt", params: [o.payoutTx] }]);
  const ok = res?.[0]?.result?.status === "0x1";
  o.receipt = { ...(o.receipt ?? {}), verifiedViaChainstack: ok };
  save();
}

/** One paid Cencori completion ($0.01). */
export async function llm(system: string, user: string, maxTokens: 256 | 1024 | 4096 = 256): Promise<string> {
  const r = await paid("cencori.chat", "/cencori/v1/chat/completions", {
    model: "maximo-atlas-1.3", max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  }, 0.01);
  return String(r?.choices?.[0]?.message?.content ?? "");
}

export function buySummary() {
  const ok = db.buyPayments.filter((p) => p.ok);
  const by: Record<string, { calls: number; usd: number }> = {};
  for (const p of ok) { const b = (by[p.service] ??= { calls: 0, usd: 0 }); b.calls++; b.usd += p.usd; }
  return { totalCalls: ok.length, totalUsd: ok.reduce((s, p) => s + p.usd, 0), byService: by, recent: db.buyPayments.slice(-20) };
}
