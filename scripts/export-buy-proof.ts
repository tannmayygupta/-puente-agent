// Writes docs/buy-proof.md from the paid buy calls recorded in data/state.json (Build with buy submission proof).
import { mkdirSync, writeFileSync } from "node:fs";
import { AGENT } from "../src/chain.js";
import { db } from "../src/store.js";
import { buySummary } from "../src/buy.js";

const s = buySummary();
const rows = db.buyPayments.filter((p) => p.ok);
const md = [
  "# Build with buy: proof of paid calls",
  "",
  `Payer wallet (tagged agent wallet): \`${AGENT}\``,
  `Gateway: https://gateway.usebuy.ai (x402 on Celo mainnet)`,
  "",
  `Total paid calls: **${s.totalCalls}** - total spend: **$${s.totalUsd.toFixed(3)}**`,
  "",
  "| Service | Calls | USD |", "|---|---|---|",
  ...Object.entries(s.byService).map(([k, v]) => `| ${k} | ${v.calls} | $${v.usd.toFixed(3)} |`),
  "",
  "## Calls",
  "| Time (UTC) | Service | USD | Settlement tx |", "|---|---|---|---|",
  ...rows.map((p) => `| ${new Date(p.ts).toISOString()} | ${p.service} | $${p.usd.toFixed(3)} | ${p.settleTx ? `[${p.settleTx.slice(0, 12)}...](https://celoscan.io/tx/${p.settleTx})` : "n/a"} |`),
  "",
  "Why each call exists: every payout runs one batched Celo RPC call (Chainstack) to pre-check the recipient and post-verify the payout, and natural-language orders are parsed by Cencori. Spend is capped per call and per day.",
].join("\n");
mkdirSync("docs", { recursive: true });
writeFileSync("docs/buy-proof.md", md);
console.log(`wrote docs/buy-proof.md (${rows.length} calls)`);
process.exit(0);
