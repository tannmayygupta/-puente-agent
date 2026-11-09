// Hermetic end-to-end tests. They run the REAL production modules (orders, payout, refund, treasury, buy, HTTP API,
// x402 route) against an in-memory simulated chain and Textile venue (src/sim.ts, SIM=1). No network, no real money.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";
import { concat, getAddress, parseUnits } from "viem";

process.env.SIM = "1";
process.env.NO_BOOT = "1";
process.env.LEAN = "1";
process.env.TREASURY_AUTO = "0";
process.env.PAYOUT_RETRY_MS = "0";
process.env.AGENT_ID = "777";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "puente-test-"));
process.env.AGENT_PRIVATE_KEY = generatePrivateKey();
delete process.env.DRY_RUN;

const cfg = await import("../src/config.js");
const { AGENT } = await import("../src/chain.js");
const { sim } = await import("../src/sim.js");
const { db } = await import("../src/store.js");
const orders = await import("../src/orders.js");
const payout = await import("../src/payout.js");
const treasury = await import("../src/treasury.js");
const buy = await import("../src/buy.js");
const identity = await import("../src/identity.js");
const { app } = await import("../src/server.js");
const { STABLES, LOCALS, PARAMS } = cfg;

const PAYER = getAddress("0x1111111111111111111111111111111111111111");
const RECIP = getAddress("0x2222222222222222222222222222222222222222");
let ipn = 0;
const newIp = () => `ip-${++ipn}`;
const u18 = (n: number | string) => parseUnits(String(n), 18);
const bal = (token: string, who: string = AGENT) => sim.get(token, who);

function reset() {
  sim.reset();
  for (const k of Object.keys(db.orders)) delete db.orders[k];
  db.decisions.length = 0; db.swaps.length = 0; db.buyPayments.length = 0;
  for (const k of Object.keys(db.usedLogs)) delete db.usedLogs[k];
  for (const k of Object.keys(db.pendingConsolidate)) delete db.pendingConsolidate[k];
  for (const k of Object.keys(db.floatCost)) delete db.floatCost[k];
  db.realizedFxPnlUsd = 0;
}
async function newOrder(over: Record<string, unknown> = {}) {
  return orders.createOrder({ currency: "ARS", recipient: RECIP, usd: 1.5, lang: "en", ip: newIp(), ...over } as never);
}
function pay(o: { priceAtomic: string }, token = STABLES.USDT) {
  sim.credit(token.address, PAYER, BigInt(o.priceAtomic));
  return sim.transfer(token.address, PAYER, AGENT, BigInt(o.priceAtomic));
}
async function until(o: { state: string; note?: string }, states: string[], ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await payout.payoutTick();
    if (states.includes(o.state)) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.fail(`order stuck in "${o.state}" (${o.note ?? "no note"})`);
}

// ------------------------------------------------------------------ quotes & validation
test("quotes: payout math, fee, unique price fingerprints", async () => {
  reset();
  const o = await newOrder({ usd: 2 });
  assert.equal(o.payoutLocal, (Math.floor(2 * o.rate * 100) / 100).toFixed(2));
  assert.equal(o.feeUsd, 0.05); // lean min fee
  assert.ok(BigInt(o.priceAtomic) >= 2_050_001n && BigInt(o.priceAtomic) <= 2_050_901n);
  const seen = new Set<string>();
  for (let i = 0; i < 18; i++) seen.add((await newOrder()).priceAtomic);
  assert.equal(seen.size, 18, "every open order must have a unique price fingerprint");
});

test("validation: amounts, addresses, currencies, daily cap", async () => {
  reset();
  await assert.rejects(newOrder({ usd: 1 }), /minimum/);
  await assert.rejects(newOrder({ usd: 6 }), /maximum/);
  await assert.rejects(newOrder({ recipient: "0x123" }), /valid/);
  await assert.rejects(newOrder({ recipient: "0x0000000000000000000000000000000000000000" }), /not allowed/);
  await assert.rejects(newOrder({ recipient: AGENT }), /not allowed/);
  await assert.rejects(newOrder({ recipient: STABLES.USDT.address }), /not allowed/);
  await assert.rejects(newOrder({ currency: "EUR" }), /unsupported/);
  await assert.rejects(newOrder({ currency: "MXN" }), /not available/); // no makers online in the simulation
  for (let i = 0; i < 8; i++) await newOrder({ usd: 5 });
  await assert.rejects(newOrder({ usd: 5 }), /daily volume/);
});

// ------------------------------------------------------------------ payout, swap, refund (LatAm + Textile + x402 tracks)
test("happy path (USDT): payment seen onchain -> just-in-time Textile swap -> wARS payout", async () => {
  reset();
  const o = await newOrder({ usd: 1.5 });
  const txh = pay(o);
  await until(o, ["completed"]);
  assert.equal(o.payer, PAYER);
  assert.equal(o.payTx, txh);
  assert.equal(bal(LOCALS.ARS.address, RECIP), u18(o.payoutLocal), "recipient must receive exactly the quoted local amount");
  assert.equal(db.swaps.length, 1);
  assert.equal(db.swaps[0].kind, "jit");
  assert.ok(bal(STABLES.USDT.address) < BigInt(o.priceAtomic) / 10n, "the payment funded the swap; only change remains");
  assert.ok(db.decisions.some((d) => d.kind === "payment_seen") && db.decisions.some((d) => d.kind === "payout"));
  assert.ok(db.buyPayments.some((p) => p.service === "chainstack.celo"), "payout runs a paid buy/Chainstack pre-check");
  assert.match(o.note ?? "", /pre-check via buy/);
});

test("happy path (USAT): USA₮ is converted to USDT then to wBRL, recipient paid", async () => {
  reset();
  const o = await newOrder({ currency: "BRL", usd: 1.5 });
  pay(o, STABLES.USAT);
  await until(o, ["completed"]);
  assert.equal(bal(LOCALS.BRL.address, RECIP), u18(o.payoutLocal));
  assert.equal(bal(STABLES.USAT.address), 0n, "USA₮ was swapped");
  assert.deepEqual(db.swaps.map((s) => s.kind), ["consolidate", "jit"]);
  assert.equal(db.pendingConsolidate[STABLES.USAT.address] ?? "0", "0", "a payment already converted must not be queued for consolidation again");
});

test("existing float is used with no swap", async () => {
  reset();
  sim.credit(LOCALS.COP.address, AGENT, u18(100000));
  const o = await newOrder({ currency: "COP", usd: 1.5 });
  pay(o);
  await until(o, ["completed"]);
  assert.equal(db.swaps.length, 0);
  assert.equal(bal(LOCALS.COP.address, RECIP), u18(o.payoutLocal));
  assert.equal(bal(STABLES.USDT.address), BigInt(o.priceAtomic), "USDT revenue is kept");
});

test("no false matches: wrong amount ignored; expired orders expire; a payment funds only one order", async () => {
  reset();
  const a = await newOrder();
  sim.credit(STABLES.USDT.address, PAYER, 10_000_000n);
  sim.transfer(STABLES.USDT.address, PAYER, AGENT, BigInt(a.priceAtomic) + 1n); // off by one micro-dollar
  for (let i = 0; i < 4; i++) await payout.payoutTick();
  assert.equal(a.state, "quoted");
  a.expiresAt = Date.now() - (PARAMS.payerWaitSec + 1) * 1000;
  await payout.payoutTick();
  assert.equal(a.state, "expired");

  reset();
  const b = await newOrder();
  const c = await newOrder();
  pay(b);
  await until(b, ["completed"]);
  for (let i = 0; i < 4; i++) await payout.payoutTick();
  assert.equal(c.state, "quoted", "second order must not be paid by the first order's transfer");
  assert.equal(Object.keys(db.usedLogs).length, 1);
  assert.equal(bal(LOCALS.ARS.address, RECIP), u18(b.payoutLocal), "no double payout");
});

test("refund (swap already done, payout transfer keeps failing): payer gets the wARS back", async () => {
  reset();
  sim.failTransfersTo.add(RECIP.toLowerCase());
  const o = await newOrder();
  pay(o);
  await until(o, ["refunded"]);
  assert.equal(bal(LOCALS.ARS.address, PAYER), u18(o.payoutLocal));
  assert.match(o.note ?? "", /wARS/);
  assert.ok(o.refundTx);
  assert.match(db.decisions.find((d) => d.kind === "refund")!.reason, /refunded in wARS/, "the public log must name the token actually refunded");
});

test("refund (Textile venue down): payer gets the SAME token back, nothing swapped", async () => {
  reset();
  sim.failSwaps = 99;
  const o = await newOrder();
  pay(o, STABLES.USAT);
  await until(o, ["refunded"]);
  assert.equal(bal(STABLES.USAT.address, PAYER), BigInt(o.priceAtomic));
  assert.equal(db.swaps.length, 0);
  assert.ok(!/ in /.test(o.note ?? ""), "same-token refund");
});

// ------------------------------------------------------------------ treasury (Textile track)
test("treasury: critical float refills immediately and tracks cost basis", async () => {
  reset();
  sim.rates.ARS = 0; sim.rates.COP = 0;
  sim.credit(STABLES.USDT.address, AGENT, 20_000_000n);
  await treasury.tick();
  assert.equal(db.swaps.length, 1);
  assert.equal(db.swaps[0].kind, "refill");
  assert.ok(db.decisions.some((d) => d.kind === "refill"));
  assert.ok(bal(LOCALS.BRL.address) > u18(10), "BRL float bought");
  assert.ok(db.floatCost.BRL.qty > 0 && db.floatCost.BRL.usd > 0);
});

test("treasury: rate guard waits on a bad rate and refills when within 5 bps of the 30-minute best", async () => {
  reset();
  sim.rates.BRL = 0; sim.rates.COP = 0;
  sim.credit(STABLES.USDT.address, AGENT, 20_000_000n);
  sim.credit(LOCALS.ARS.address, AGENT, u18(1650)); // float about $1: low but not critical
  sim.rates.ARS = 1700; await treasury.tick();
  sim.rates.ARS = 1650; await treasury.tick();
  await treasury.tick();
  assert.equal(db.swaps.length, 0, "must not refill 294 bps below the best rate");
  assert.ok(db.decisions.some((d) => d.kind === "wait"));
  sim.rates.ARS = 1700; await treasury.tick();
  assert.equal(db.swaps.length, 1, "refills once the rate is back at the best");
  assert.match(db.decisions.find((d) => d.kind === "refill")!.reason, /within 5 bps/);
});

test("treasury: total exposure cap blocks a refill", async () => {
  reset();
  sim.rates.BRL = 0;
  sim.credit(STABLES.USDT.address, AGENT, 20_000_000n);
  sim.credit(LOCALS.ARS.address, AGENT, u18(7.5 * 1650));
  sim.credit(LOCALS.COP.address, AGENT, u18(0.5 * 3230)); // critical, but total float would exceed the $8 cap
  await treasury.tick();
  assert.equal(db.swaps.length, 0);
  assert.ok(db.decisions.some((d) => d.kind === "skip"));
});

test("treasury: collected USA₮ is consolidated into USDT in a batch", async () => {
  reset();
  sim.rates.ARS = 0; sim.rates.BRL = 0; sim.rates.COP = 0;
  sim.credit(STABLES.USAT.address, AGENT, 1_500_000n);
  db.pendingConsolidate[STABLES.USAT.address] = "1500000";
  await treasury.tick();
  assert.equal(db.swaps.length, 1);
  assert.equal(db.swaps[0].kind, "consolidate");
  assert.equal(db.pendingConsolidate[STABLES.USAT.address], "0");
  assert.ok(bal(STABLES.USDT.address) > 1_490_000n);
});

test("P&L: realised FX P&L is positive when float was bought cheaper than the quoted rate", () => {
  reset();
  db.floatCost.ARS = { qty: 1650, usd: 1.0 }; // bought at 1650 ARS/USD
  treasury.recordPayout("ARS", 825, 1600); // quoted to the payer at 1600
  assert.ok(Math.abs(db.realizedFxPnlUsd - (825 / 1600 - 0.5)) < 1e-9);
  assert.equal(db.floatCost.ARS.qty, 825);
});

// ------------------------------------------------------------------ buy track
test("buy: paid calls are recorded and capped by a daily budget", async () => {
  reset();
  process.env.BUY_MAX_USD_PER_DAY = "0.035";
  await buy.rpcBatch([{ method: "eth_blockNumber", params: [] }]);
  await buy.rpcBatch([{ method: "eth_blockNumber", params: [] }]);
  await buy.llm("sys", "hi");
  await assert.rejects(buy.rpcBatch([{ method: "eth_blockNumber", params: [] }]), /budget/);
  delete process.env.BUY_MAX_USD_PER_DAY;
  const s = buy.buySummary();
  assert.equal(s.totalCalls, 3);
  assert.ok(Math.abs(s.totalUsd - 0.03) < 1e-9);
  assert.deepEqual(Object.keys(s.byService).sort(), ["cencori.chat", "chainstack.celo"]);
});

// ------------------------------------------------------------------ HTTP API + x402 route
const post = (path: string, body?: unknown, ip = newIp()) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: body === undefined ? undefined : JSON.stringify(body) });

test("API: config, order lifecycle endpoints and guards", async () => {
  reset();
  const cfgRes = await app.request("/api/config");
  const c: any = await cfgRes.json();
  assert.equal(cfgRes.status, 200);
  assert.equal(c.payTo, AGENT);
  assert.equal(c.agentId, "777");
  assert.equal(c.acceptedTokens.length, 3);
  assert.deepEqual(c.currencies.map((x: any) => x.code), ["ARS", "BRL", "COP"]);

  assert.equal((await post("/v1/orders", { currency: "ARS", recipient: "nope", usd: 2 })).status, 400);
  assert.equal((await post("/v1/orders", { currency: "ARS", recipient: RECIP, usd: 1 })).status, 400);
  const ok = await post("/v1/orders", { currency: "ARS", recipient: RECIP, usd: 2, lang: "es" });
  assert.equal(ok.status, 201);
  const created: any = await ok.json();
  const id = created.order.id;
  assert.equal(created.payUrl, `/v1/pay?order=${id}`);
  assert.equal((await app.request(`/v1/orders/${id}`)).status, 200);
  assert.equal((await app.request(`/v1/orders/nope`)).status, 404);

  assert.equal((await post(`/v1/pay?order=nope`)).status, 404);
  assert.equal((await app.request(`/v1/pay?order=${id}`)).status, 405);
  db.orders[id].expiresAt = Date.now() - 1000;
  assert.equal((await post(`/v1/pay?order=${id}`)).status, 410);
  db.orders[id].expiresAt = Date.now() + 60000; db.orders[id].state = "payment_pending";
  assert.equal((await post(`/v1/pay?order=${id}`)).status, 409);
});

test("API: per-IP rate limit on quotes", async () => {
  reset();
  let last = 0;
  for (let i = 0; i < PARAMS.quotesPerMinPerIp + 1; i++) last = (await post("/v1/orders", { currency: "ARS", recipient: "bad", usd: 2 }, "rate-limit-ip")).status;
  assert.equal(last, 429);
});

test("x402: unpaid request gets a 402 with exact dynamic price for USA₮, USD₮ and USDC, payable to the agent wallet", async (t) => {
  reset();
  try { const r = await fetch("https://api.x402.celo.org/supported", { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(String(r.status)); }
  catch { t.skip("Celo x402 facilitator not reachable from this environment"); return; }
  const o = await newOrder({ usd: 2 });
  const res = await post(`/v1/pay?order=${o.id}`);
  assert.equal(res.status, 402);
  const hdr = res.headers.get("payment-required")!;
  const dec = JSON.parse(Buffer.from(hdr, "base64").toString("utf8"));
  assert.equal(dec.accepts.length, 3);
  const assets = dec.accepts.map((a: any) => a.asset.toLowerCase()).sort();
  assert.deepEqual(assets, [STABLES.USAT, STABLES.USDT, STABLES.USDC].map((s) => s.address.toLowerCase()).sort());
  for (const a of dec.accepts) { assert.equal(a.amount, o.priceAtomic); assert.equal(a.payTo, AGENT); assert.equal(a.network, "eip155:42220"); }
});

test("natural-language entry: Spanish and Portuguese instructions are understood (deterministic fallback)", async () => {
  reset();
  const es: any = await (await post("/v1/parse", { text: `Enviar $5 en pesos argentinos a ${RECIP}` })).json();
  assert.equal(es.parsed.currency, "ARS"); assert.equal(es.parsed.usd, 5); assert.equal(es.parsed.recipient, RECIP);
  const pt: any = await (await post("/v1/parse", { text: `Mandar 20 reais para ${RECIP}` })).json();
  assert.equal(pt.parsed.currency, "BRL"); assert.equal(pt.parsed.local, 20); assert.equal(pt.parsed.usd, null);
});

test("transparency endpoints and agent identity file", async () => {
  reset();
  assert.equal((await app.request("/stats")).status, 200);
  assert.equal((await app.request("/agent/log")).status, 200);
  const f: any = await (await app.request("/agent.json")).json();
  assert.equal(f.x402Support, true);
  assert.equal(f.payTo, AGENT);
  assert.equal(f.registrations[0].agentId, 777);
  assert.equal(f.registrations[0].agentRegistry, `eip155:42220:${identity.IDENTITY_REGISTRY}`);
});

// ------------------------------------------------------------------ safety & attribution
test("safety: dry-run mode and test overrides are OFF by default; attribution suffix round-trips", async () => {
  assert.equal(cfg.DRY_RUN, false);
  assert.equal(PARAMS.orderMinUsd, 1.25);
  assert.equal(PARAMS.orderMaxUsd, 5);
  const { toDataSuffix, fromDataSuffix } = await import("@celo/attribution-tags");
  const decoded = fromDataSuffix(concat(["0xa9059cbb", toDataSuffix(cfg.ENV.attribution)]));
  assert.deepEqual(decoded?.codes, ["celo_eabed0a00299"]);
});
