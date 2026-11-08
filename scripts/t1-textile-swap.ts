// T1: one REAL Textile swap from wallet T (default: 1.2 USDT -> wARS). Proves takerProof + firm quote + tagged swap.
//   npx tsx scripts/t1-textile-swap.ts            (dry run: previews only)
//   npx tsx scripts/t1-textile-swap.ts --live [usd] [ARS|BRL|COP]
import { parseUnits } from "viem";
import { fmt, publicClient, balanceOf, AGENT } from "../src/chain.js";
import { LOCALS, STABLES, ENV, type CurrencyCode } from "../src/config.js";
import { preview, swap } from "../src/textile.js";
import { verifyTx } from "@celo/attribution-tags";

const live = process.argv.includes("--live");
const rest = process.argv.slice(2).filter((a) => a !== "--live");
const usd = Number(rest[0] ?? 1.2);
const code = (rest[1] ?? "ARS") as CurrencyCode;
const local = LOCALS[code];

const sellAmt = parseUnits(usd.toFixed(6), 6);
const p = await preview(STABLES.USDT.address, local.address, sellAmt);
console.log(`preview ${usd} USDT -> ${local.symbol}:`, p.ok ? fmt(p.buyAmount, 18) : `no quote (${p.reason})`);
console.log("wallet USDT:", fmt(await balanceOf(STABLES.USDT.address), 6), `${local.symbol}:`, fmt(await balanceOf(local.address), 18));
if (!live) { console.log("dry run only. add --live to execute a real swap."); process.exit(0); }

const before = await balanceOf(local.address);
const r = await swap(STABLES.USDT.address, local.address, sellAmt);
console.log("SWAP OK", { rfqId: r.rfqId, tx: r.txHash, sold: fmt(r.sold, 6), bought: fmt(r.bought, 18) });
const after = await balanceOf(local.address);
console.log(`${local.symbol} balance delta:`, fmt(after - before, 18));
const tag = await verifyTx({ client: publicClient as never, hash: r.txHash });
console.log("attribution tag on swap tx:", tag?.codes, tag?.codes?.includes(ENV.attribution) ? "OK" : "MISSING");
console.log("celoscan: https://celoscan.io/tx/" + r.txHash, "| wallet", AGENT);
process.exit(0);
