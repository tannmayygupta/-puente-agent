// Move a few cents of USDT from agent wallet T to our own test payer wallet (tagged tx, gas in CELO).
//   npx tsx scripts/fund-buyer.ts 0.06
import { parseUnits } from "viem";
import { balanceOf, fmt, sendTransfer } from "../src/chain.js";
import { STABLES } from "../src/config.js";

const amt = process.argv[2] ?? "0.06";
const to = process.env.BUYER_ADDRESS as `0x${string}`;
if (!to) throw new Error("BUYER_ADDRESS missing");
console.log("T USDT before:", fmt(await balanceOf(STABLES.USDT.address), 6));
const s = await sendTransfer(STABLES.USDT.address, to, parseUnits(amt, 6), "fund-test-payer");
console.log("funded", to, amt, "USDT, tx", s.hash);
console.log("buyer USDT now:", fmt(await balanceOf(STABLES.USDT.address, to), 6));
process.exit(0);
