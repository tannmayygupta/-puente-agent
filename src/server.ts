import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { AGENT } from "./chain.js";
import { ACTIVE_CURRENCIES, CAIP2, ENV, LOCALS, PARAMS, STABLE_LIST } from "./config.js";
import { db, save } from "./store.js";
import { UserError, createOrder, getOrder, publicOrder, validateRecipient } from "./orders.js";
import { startPayoutWorker } from "./payout.js";
import { startTreasury } from "./treasury.js";
import { localPerUsd } from "./textile.js";
import { stats } from "./stats.js";
import { registrationFile } from "./identity.js";
import { llm } from "./buy.js";

const app = new Hono();
app.use("/api/*", cors());
app.use("/v1/*", cors({ origin: "*", exposeHeaders: ["payment-response", "x-payment-response", "payment-required"] }));

// ---------- tiny per-IP rate limiter ----------
const buckets = new Map<string, number[]>();
function limited(ip: string, key: string, max: number, windowMs = 60_000): boolean {
  const k = `${key}:${ip}`;
  const now = Date.now();
  const arr = (buckets.get(k) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(k, arr); return true; }
  arr.push(now); buckets.set(k, arr);
  return false;
}
const ipOf = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? c.req.header("x-real-ip") ?? "local";

// ---------- x402 seller (Celo mainnet facilitator) ----------
const apiKey = process.env.X402_API_KEY;
if (!apiKey) console.warn("[x402] X402_API_KEY missing: /v1/pay cannot settle until it is set");
const facilitator = new HTTPFacilitatorClient({
  url: ENV.facilitatorUrl,
  createAuthHeaders: async () => {
    const h = { "X-API-Key": apiKey ?? "" };
    return { verify: h, settle: h, supported: h };
  },
});
const x402Server = new x402ResourceServer(facilitator);
x402Server.register("eip155:*", new ExactEvmScheme());

const orderFromCtx = (ctx: any) => {
  const q = ctx?.adapter?.getQueryParam?.("order");
  const id = Array.isArray(q) ? q[0] : q;
  const o = id ? getOrder(String(id)) : undefined;
  if (!o) throw new Error("unknown order");
  return o;
};

const routes = {
  "POST /v1/pay": {
    description: "Pay a Puente order (price comes from the order quote). Accepts USA₮, USD₮ or USDC.",
    mimeType: "application/json",
    accepts: STABLE_LIST.map((s) => ({
      scheme: "exact",
      network: CAIP2,
      payTo: AGENT,
      // explicit {amount, asset, extra}: a bare "$x" would silently resolve to USDC
      price: (ctx: any) => ({ amount: orderFromCtx(ctx).priceAtomic, asset: s.address, extra: s.x402 }),
    })),
  },
};

// guard BEFORE the payment middleware: unknown/expired/duplicate orders never reach the 402 challenge
const inflight = new Set<string>();
app.use("/v1/pay", async (c, next) => {
  if (c.req.method !== "POST") return c.json({ error: "use POST" }, 405);
  const id = c.req.query("order") ?? "";
  const o = getOrder(id);
  if (!o) return c.json({ error: "unknown order" }, 404);
  if (o.state !== "quoted") return c.json({ error: `order is ${o.state}` }, 409);
  if (Date.now() > o.expiresAt) return c.json({ error: "quote expired, create a new order" }, 410);
  if (inflight.has(id)) return c.json({ error: "payment already in progress" }, 409);
  inflight.add(id);
  try { await next(); } finally { inflight.delete(id); }
});
app.use(paymentMiddleware(routes as never, x402Server));

// Handler runs only after the payment verified. It NEVER pays out: the payout worker waits for the onchain Transfer.
app.post("/v1/pay", (c) => {
  const o = getOrder(c.req.query("order") ?? "")!;
  o.state = "payment_pending";
  save();
  return c.json({ status: "payment_accepted", message: "payment verified; confirming onchain, payout follows", order: publicOrder(o) });
});

// ---------- public API ----------
app.get("/health", (c) => c.json({ ok: true, paused: ENV.paused() }));

app.get("/api/config", async (c) => {
  const rates: Record<string, number | null> = {};
  for (const code of ACTIVE_CURRENCIES) {
    try { const r = await localPerUsd(code); rates[code] = r.ok ? r.rate : null; } catch { rates[code] = null; }
  }
  return c.json({
    name: "Puente", network: "celo-mainnet", chainId: 42220, payTo: AGENT, attributionTag: ENV.attribution,
    agentId: db.agentId ?? null,
    currencies: ACTIVE_CURRENCIES.map((code) => ({ code, token: LOCALS[code].symbol, address: LOCALS[code].address, country: LOCALS[code].country, name: LOCALS[code].name, ratePerUsd: rates[code] })),
    acceptedTokens: STABLE_LIST.map((s) => ({ symbol: s.symbol, address: s.address, x402: s.x402 })),
    fee: { pct: PARAMS.feePct, minUsd: PARAMS.feeMinUsd },
    limits: { minUsd: PARAMS.orderMinUsd, maxUsd: PARAMS.orderMaxUsd, quoteValiditySec: PARAMS.quoteValiditySec },
    flow: ["POST /v1/orders -> returns order + price", "POST /v1/pay?order=<id> (x402, USAT/USDT/USDC) -> payout in seconds", "GET /v1/orders/<id> -> status + receipt"],
  });
});

app.post("/v1/orders", async (c) => {
  const ip = ipOf(c);
  if (limited(ip, "orders", PARAMS.quotesPerMinPerIp)) return c.json({ error: "slow down" }, 429);
  try {
    const b = await c.req.json();
    const o = await createOrder({ currency: b.currency, recipient: b.recipient, usd: b.usd, local: b.local, lang: b.lang, ip });
    return c.json({ order: publicOrder(o), payUrl: `/v1/pay?order=${o.id}`, howTo: "POST payUrl with any x402 client; the 402 challenge lists USAT, USDT and USDC at the exact price" }, 201);
  } catch (e) {
    if (e instanceof UserError) return c.json({ error: e.message }, e.status as 400);
    console.error("[orders]", e);
    return c.json({ error: "could not create order" }, 500);
  }
});

app.get("/v1/orders/:id", (c) => {
  const o = getOrder(c.req.param("id"));
  if (!o) return c.json({ error: "not found" }, 404);
  return c.json({ order: publicOrder(o) });
});

// ---------- natural-language entry (Cencori via buy, deterministic fallback) ----------
function fallbackParse(text: string) {
  const addr = text.match(/0x[a-fA-F0-9]{40}/)?.[0] ?? null;
  const t = text.toLowerCase();
  let currency: string | null = null;
  if (/\b(ars|argentin|argentina|peso argentino)/.test(t)) currency = "ARS";
  else if (/\b(brl|reais|real|brasil|brazil|brasileiro)/.test(t)) currency = "BRL";
  else if (/\b(cop|colombia|colombian)/.test(t)) currency = "COP";
  else if (/\b(mxn|mexic)/.test(t)) currency = "MXN";
  const n = text.match(/(\$\s*)?(\d+(?:[.,]\d+)?)/);
  const num = n ? Number(n[2].replace(",", ".")) : null;
  const isUsd = !!(n && n[1]) || /\b(usd|dollar|dolar|dólar|dolares|dólares)/.test(t);
  const lang = /\b(envia|enviar|manda|pesos|dólares|dolares)\b/.test(t) ? "es" : /\b(enviar|reais|mandar|dólares)\b/.test(t) ? "pt" : "en";
  return { currency, usd: isUsd ? num : null, local: !isUsd ? num : null, recipient: addr, lang };
}

app.post("/v1/parse", async (c) => {
  if (limited(ipOf(c), "parse", 5)) return c.json({ error: "slow down" }, 429);
  const { text } = await c.req.json();
  const s = String(text ?? "").slice(0, 400);
  let out = fallbackParse(s);
  let via = "fallback";
  try {
    const raw = await llm(
      "Extract a payment instruction. Reply with ONLY compact JSON: {\"currency\":\"ARS|BRL|COP|MXN|null\",\"usd\":number|null,\"local\":number|null,\"recipient\":\"0x...|null\",\"lang\":\"en|es|pt\"}. usd = amount in US dollars, local = amount in the recipient currency. Never invent an address.",
      s, 256);
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const addr = typeof j.recipient === "string" && /^0x[a-fA-F0-9]{40}$/.test(j.recipient) && s.toLowerCase().includes(j.recipient.toLowerCase()) ? j.recipient : out.recipient;
    out = { currency: ["ARS", "BRL", "COP", "MXN"].includes(j.currency) ? j.currency : out.currency, usd: typeof j.usd === "number" ? j.usd : out.usd, local: typeof j.local === "number" ? j.local : out.local, recipient: addr, lang: ["en", "es", "pt"].includes(j.lang) ? j.lang : out.lang };
    via = "cencori (paid via buy)";
  } catch { /* fallback already set */ }
  try { if (out.recipient) validateRecipient(out.recipient); } catch { out.recipient = null; }
  return c.json({ parsed: out, via });
});

// ---------- transparency ----------
app.get("/stats", async (c) => c.json(await stats()));
app.get("/agent/log", (c) => c.json({ decisions: db.decisions.slice(-200).reverse() }));
app.get("/agent.json", (c) => c.json(registrationFile(db.agentId)));

app.use("/*", serveStatic({ root: "./public" }));

export { app };

// NO_BOOT=1 lets tests import the app without starting the HTTP server and background workers
if (process.env.NO_BOOT !== "1") {
  serve({ fetch: app.fetch, port: ENV.port }, (i) => {
    console.log(`Puente listening on :${i.port} | wallet ${AGENT} | tag ${ENV.attribution}`);
  });
  startPayoutWorker();
  startTreasury();
}
