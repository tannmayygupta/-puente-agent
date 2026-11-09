// T4: make real paid buy calls from wallet T: one Chainstack batch + one Cencori completion (about $0.02 total).
import { rpcBatch, llm, buySummary } from "../src/buy.js";
import { AGENT } from "../src/chain.js";

const r = await rpcBatch([{ method: "eth_blockNumber", params: [] }, { method: "eth_getBalance", params: [AGENT, "latest"] }]);
console.log("chainstack batch result:", JSON.stringify(r).slice(0, 160));
try {
  const t = await llm("Reply in one short sentence.", "Say hello to a payer sending dollars to Argentina.", 256);
  console.log("cencori reply:", t.slice(0, 160));
} catch (e) { console.log("cencori failed:", (e as Error).message); }
console.log(JSON.stringify(buySummary(), null, 2).slice(0, 700));
process.exit(0);
