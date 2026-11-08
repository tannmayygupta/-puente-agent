import { AGENT } from "./chain.js";
import { ACTIVE_CURRENCIES, ENV, LOCALS } from "./config.js";
import { buySummary } from "./buy.js";
import { db } from "./store.js";
import { rateStats, snapshot } from "./treasury.js";

let snapCache: { t: number; v: Awaited<ReturnType<typeof snapshot>> } | null = null;
async function cachedSnapshot() {
  if (snapCache && Date.now() - snapCache.t < 20_000) return snapCache.v;
  const v = await snapshot();
  snapCache = { t: Date.now(), v };
  return v;
}

export async function stats() {
  const orders = Object.values(db.orders);
  const done = orders.filter((o) => o.state === "completed");
  const payers = new Set(done.map((o) => (o.payer ?? "").toLowerCase()).filter(Boolean));
  const feeRevenueUsd = done.reduce((s, o) => s + o.feeUsd, 0);
  const swapsOk = db.swaps;
  const filledUsd = swapsOk.reduce((s, x) => s + x.sellUsd, 0);
  const textileFeesUsd = swapsOk.reduce((s, x) => s + x.feeUsd, 0);
  const buy = buySummary();
  const bpsList = swapsOk.filter((x) => x.kind === "refill" && x.bpsVsEma !== undefined).map((x) => x.bpsVsEma as number);
  const avgBps = bpsList.length ? bpsList.reduce((a, b) => a + b, 0) / bpsList.length : null;
  const netUsd = feeRevenueUsd + db.realizedFxPnlUsd - textileFeesUsd - buy.totalUsd;
  const snap = await cachedSnapshot().catch(() => null);
  return {
    agent: { wallet: AGENT, attributionTag: ENV.attribution, agentId: db.agentId ?? null, payTo: AGENT },
    orders: {
      total: orders.length, completed: done.length, refunded: orders.filter((o) => o.state === "refunded").length,
      volumeUsd: done.reduce((s, o) => s + o.usd, 0), uniquePayers: payers.size, payers: [...payers],
    },
    textile: {
      previewsServed: db.quotesServed, previewVolumeUsd: db.previewQuoteVolumeUsd,
      firmQuotesRequested: db.firmQuotesRequested, swapsFilled: swapsOk.length, filledVolumeUsd: filledUsd,
      byKind: swapsOk.reduce<Record<string, number>>((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {}),
      avgRefillBpsVs30mAvg: avgBps,
      recentSwaps: swapsOk.slice(-10).reverse(),
    },
    pnl: { feeRevenueUsd, realizedFxPnlUsd: db.realizedFxPnlUsd, textileFeesUsd, buySpendUsd: buy.totalUsd, netUsd, note: "excludes gas and x402 facilitator fees; can be negative" },
    buy,
    rates: Object.fromEntries(ACTIVE_CURRENCIES.map((c) => [c, { token: LOCALS[c].symbol, ...rateStats(c) }])),
    treasury: snap,
  };
}
