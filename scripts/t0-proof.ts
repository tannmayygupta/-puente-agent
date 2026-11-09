// T0 (no money needed): proves our takerProof signing + firm-quote request format against Textile.
// Expected: Textile accepts the proof and answers `insufficient_funds` (wallet holds no USDT) - NOT a proof error.
import { parseUnits } from "viem";
import { LOCALS, STABLES } from "../src/config.js";
import { requestFirm, TextileError } from "../src/textile.js";

try {
  const q = await requestFirm(STABLES.USDT.address, LOCALS.ARS.address, parseUnits("1", 6));
  console.log("UNEXPECTED: got a firm quote", q.rfqId);
} catch (e) {
  const te = e as TextileError;
  console.log("result:", te.message, "| status", te.status, "| reason", te.reason);
  console.log(te.reason === "insufficient_funds" ? "PASS: proof accepted, request format valid (only funds missing)" : "CHECK: unexpected response");
}
process.exit(0);
