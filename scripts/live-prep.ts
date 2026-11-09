// One-shot prep for the first real loop once ~$3.5 of USDT is in wallet T:
//   1) real Textile swap USDT -> wARS (this becomes the float)   [--float 1.6]
//   2) send USDT to our test payer wallet so it can pay an order over x402 [--buyer 1.7]
//   npx tsx scripts/live-prep.ts --float 1.6 --buyer 1.7
import { parseUnits } from "viem";
import { AGENT, balanceOf, fmt, publicClient, sendTransfer } from "../src/chain.js";
import { ENV, LOCALS, STABLES } from "../src/config.js";
import { swap } from "../src/textile.js";
import { verifyTx } from "@celo/attribution-tags";

const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? Number(process.argv[i + 1]) : d; };
const floatUsd = arg("float", 1.6);
const buyerUsd = arg("buyer", 1.7);
const buyerAddr = process.env.BUYER_ADDRESS as `0x${string}` | undefined;
if (!buyerAddr) throw new Error("BUYER_ADDRESS missing in .env");

const usdt = fmt(await balanceOf(STABLES.USDT.address), 6);
console.log(`wallet ${AGENT} USDT: ${usdt}`);
if (usdt < floatUsd + buyerUsd) throw new Error(`need about ${floatUsd + buyerUsd} USDT, have ${usdt}`);

if (floatUsd > 0) {
  const r = await swap(STABLES.USDT.address, LOCALS.ARS.address, parseUnits(floatUsd.toFixed(6), 6));
  const tag = await verifyTx({ client: publicClient as never, hash: r.txHash });
  console.log("SWAP OK", { rfqId: r.rfqId, tx: r.txHash, sold: fmt(r.sold, 6), boughtWARS: fmt(r.bought, 18), tagOk: tag?.codes?.includes(ENV.attribution) });
}
if (buyerUsd > 0) {
  const s = await sendTransfer(STABLES.USDT.address, buyerAddr, parseUnits(buyerUsd.toFixed(6), 6), "fund-test-payer");
  console.log("FUNDED test payer", buyerAddr, "tx", s.hash);
}
console.log("Next: start the server (npm start), then: npm run t2 -- 1.5 ARS USDT <recipient>");
process.exit(0);
