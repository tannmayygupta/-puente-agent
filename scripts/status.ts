// Prints wallet T balances, current rates and the recent agent decisions (local state file).
import { snapshot, rateStats } from "../src/treasury.js";
import { localPerUsd } from "../src/textile.js";
import { ACTIVE_CURRENCIES } from "../src/config.js";
import { db } from "../src/store.js";

const s = await snapshot();
console.log("wallet:", s.wallet);
for (const [k, v] of Object.entries(s.balances)) console.log(`  ${k.padEnd(5)} ${v.amount}`);
for (const c of ACTIVE_CURRENCIES) { const r = await localPerUsd(c); console.log(`rate ${c}:`, r.ok ? r.rate.toFixed(4) : `n/a (${r.reason})`, rateStats(c).samples ? "" : ""); }
console.log("orders:", Object.keys(db.orders).length, "swaps:", db.swaps.length, "buy calls:", db.buyPayments.length);
process.exit(0);
