// T2: act as an outside payer. Creates an order and pays it over x402 from BUYER_PRIVATE_KEY, then waits for the payout.
//   npx tsx scripts/t2-pay.ts [usd=2] [ARS|BRL|COP] [USDT|USAT|USDC] [recipient] [baseUrl]
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { ENV, STABLES } from "../src/config.js";

const key = process.env.BUYER_PRIVATE_KEY;
if (!key) throw new Error("BUYER_PRIVATE_KEY missing (run: npm run wallet:new -- --buyer, then fund it)");
const buyer = privateKeyToAccount(key as `0x${string}`);
const usd = Number(process.argv[2] ?? 2);
const currency = process.argv[3] ?? "ARS";
const tokenSym = (process.argv[4] ?? "USDT") as keyof typeof STABLES;
const recipient = process.argv[5] ?? process.env.TEST_RECIPIENT ?? buyer.address;
const base = (process.argv[6] ?? "http://localhost:3000").replace(/\/$/, "");

const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(buyer, { rpcUrl: ENV.rpcUrl }));
client.setSpendControls({ maxAmountPerPayment: "$30", allowedAssets: true } as never);
const want = STABLES[tokenSym].address.toLowerCase();
client.registerPolicy((_v, reqs) => { const m = reqs.filter((r) => String((r as { asset?: string }).asset).toLowerCase() === want); return m.length ? m : reqs; });
const payFetch = wrapFetchWithPayment(fetch, client);

console.log("payer:", buyer.address, "| paying in", tokenSym, "| recipient:", recipient);
const oRes = await fetch(`${base}/v1/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currency, recipient, usd, lang: "en" }) });
const created = await oRes.json();
if (!oRes.ok) { console.error("order failed:", created); process.exit(1); }
const o = created.order;
console.log(`order ${o.id}: recipient gets ${o.payoutLocal} ${o.token}; price $${o.price.usd}`);

const t0 = Date.now();
const pay = await payFetch(`${base}${created.payUrl}`, { method: "POST" });
console.log("pay HTTP", pay.status, await pay.text());
if (!pay.ok) process.exit(1);
const hdr = pay.headers.get("payment-response");
if (hdr) console.log("settlement:", JSON.parse(Buffer.from(hdr, "base64").toString()).transaction);

for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = (await (await fetch(`${base}/v1/orders/${o.id}`)).json()).order;
  process.stdout.write(`\r state=${s.state}   `);
  if (["completed", "refunded", "needs_manual", "expired"].includes(s.state)) {
    console.log("\nFINAL:", s.state, `in ${((Date.now() - t0) / 1000).toFixed(1)}s`, s.payoutTxUrl ?? s.refundTxUrl ?? s.note ?? "");
    process.exit(s.state === "completed" ? 0 : 2);
  }
}
console.log("\ntimeout waiting for payout");
process.exit(3);
