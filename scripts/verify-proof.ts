// Independently verifies every transaction listed in docs/PROOF.md with ONE paid, batched Chainstack call (via buy).
// Writes docs/proof-verification.md. Real call, real $0.01, nothing simulated.
import { mkdirSync, writeFileSync } from "node:fs";
import { rpcBatch } from "../src/buy.js";

const TXS: [string, string][] = [
  ["ERC-8004 register (agent #10055)", "0x6b29f4248ed82708acc7bfc848cb5ddfcfba36a7a7f7f97fe77599b102b80b6d"],
  ["ERC-8004 setAgentURI", "0x84073ff136b42e1c5eca49aa862bee48c7b63f61e1309d3c912c9db4c7f7f0c8"],
  ["Textile FX swap 1.65 CELO -> USDT", "0xddbe8b49433d43bd5491a15e0a1ae96aadb30fe746a2ecd16956b2b6f0c41a34"],
  ["buy: Chainstack call settlement", "0x4ebecec236a5502dc3f509630cfd11e81d8a844bb62f5311defe9c0a3a032f71"],
  ["buy: Cencori call settlement", "0x18ffdcf4b1ec87f76aeebba17b838395bc1b1bfdb0b9b177be9cf22cadd7b787"],
  ["x402 self-test settlement (not an independent user)", "0x042c202765cf2698bfe9d92ed6e7c06fc9325819bf1b56f46f6cb63130922f3b"],
];

const res = await rpcBatch(TXS.map(([, h]) => ({ method: "eth_getTransactionReceipt", params: [h] })));
const rows = TXS.map(([label, h], i) => {
  const r = res.find((x: any) => x.id === i + 1)?.result;
  const ok = r?.status === "0x1";
  return `| ${label} | [${h.slice(0, 12)}...](https://celoscan.io/tx/${h}) | ${r ? (ok ? "success" : "FAILED") : "not found"} | ${r ? parseInt(r.blockNumber, 16) : "-"} |`;
});
const md = [
  "# Proof verification (one paid, batched Chainstack call through buy)",
  "",
  `Verified at ${new Date().toISOString()} by reading each receipt from Celo mainnet through the buy gateway (Chainstack, $0.01).`,
  "",
  "| What | Tx | Receipt status | Block |", "|---|---|---|---|",
  ...rows, "",
].join("\n");
mkdirSync("docs", { recursive: true });
writeFileSync("docs/proof-verification.md", md);
console.log(md);
process.exit(0);
