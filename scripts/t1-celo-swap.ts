// T1 (zero extra money): real Textile swap CELO -> USDT from wallet T. Textile's minimum for this pair is about 1.6 CELO.
//   npx tsx scripts/t1-celo-swap.ts 1.65
import { parseUnits } from "viem";
import { AGENT, balanceOf, fmt, publicClient } from "../src/chain.js";
import { CELO_TOKEN, ENV, STABLES } from "../src/config.js";
import { swap } from "../src/textile.js";
import { verifyTx } from "@celo/attribution-tags";

const celo = Number(process.argv[2] ?? 1.65);
console.log("wallet", AGENT, "CELO", fmt(await balanceOf(CELO_TOKEN), 18), "USDT", fmt(await balanceOf(STABLES.USDT.address), 6));
const r = await swap(CELO_TOKEN, STABLES.USDT.address, parseUnits(celo.toString(), 18));
console.log("SWAP OK", { rfqId: r.rfqId, tx: r.txHash, soldCELO: fmt(r.sold, 18), boughtUSDT: fmt(r.bought, 6) });
const tag = await verifyTx({ client: publicClient as never, hash: r.txHash });
console.log("attribution tag on swap tx:", tag?.codes, tag?.codes?.includes(ENV.attribution) ? "OK" : "MISSING");
console.log("after: CELO", fmt(await balanceOf(CELO_TOKEN), 18), "USDT", fmt(await balanceOf(STABLES.USDT.address), 6));
console.log("https://celoscan.io/tx/" + r.txHash);
process.exit(0);
