// Debug: inspect what approval Textile asks for and simulate the swap (no broadcast).
import { decodeFunctionData, parseAbi, parseUnits, getAddress } from "viem";
import { AGENT, allowanceOf, balanceOf, fmt, publicClient } from "../src/chain.js";
import { CELO_TOKEN, STABLES, TEXTILE_REACTOR } from "../src/config.js";
import { requestFirm } from "../src/textile.js";

const PERMIT2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
const q: any = await requestFirm(CELO_TOKEN, STABLES.USDT.address, parseUnits("1.65", 18));
console.log("quote: takerPays", q.takerPays.toString(), "buy", q.buyAmount.toString(), "reactor", q.reactor, "expiresIn", Math.round((q.expiresAt - Date.now()) / 1000) + "s");
console.log("swap tx to:", q.swap.to, "dataBytes", (q.swap.data.length - 2) / 2);
console.log("approval tx from Textile:", q.approval ? { to: q.approval.to, data: q.approval.data.slice(0, 74) + "..." } : "none (allowance already enough?)");
if (q.approval) { try { const d = decodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), data: q.approval.data }); console.log("  approve spender:", d.args[0], "amount:", String(d.args[1])); } catch { console.log("  (could not decode approval data)"); } }
console.log("quote keys:", Object.keys(q.raw.quote ?? {}).join(","), "| transactions keys:", Object.keys(q.raw.transactions ?? {}).join(","));
console.log("quote.reactor:", q.raw.quote?.reactor, "| orderDeadline:", q.raw.quote?.orderDeadline);
console.log("allowance CELO->reactor:", (await allowanceOf(CELO_TOKEN, TEXTILE_REACTOR)).toString(), "| ->Permit2:", (await allowanceOf(CELO_TOKEN, PERMIT2)).toString());
console.log("balance CELO token:", fmt(await balanceOf(CELO_TOKEN), 18));
try {
  await publicClient.call({ account: AGENT, to: q.swap.to, data: q.swap.data, value: 0n });
  console.log("SIMULATION OK (would succeed now)");
} catch (e) {
  console.log("SIMULATION REVERT:", (e as Error).message.split("\n")[0].slice(0, 200));
}
process.exit(0);
