// One-off: re-add a real buy payment that was lost from local state (script exited before the debounced save).
// The settlement tx below is real and verifiable on celoscan.
import { db, saveNow } from "../src/store.js";
import { buySummary } from "../src/buy.js";

const tx = "0x18ffdcf4b1ec87f76aeebba17b838395bc1b1bfdb0b9b177be9cf22cadd7b787";
if (!db.buyPayments.some((p) => p.settleTx === tx)) {
  db.buyPayments.push({ ts: 1794209937839, service: "cencori.chat", usd: 0.01, settleTx: tx, ok: true });
  db.buyPayments.sort((a, b) => a.ts - b.ts);
}
saveNow();
console.log("buy calls recorded:", buySummary().totalCalls);
process.exit(0);
