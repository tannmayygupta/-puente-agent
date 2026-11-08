import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, formatUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { withAttribution } from "@celo/attribution-tags";
import { ENV, agentKey } from "./config.js";

export const account = privateKeyToAccount(agentKey());
export const AGENT: Address = account.address;

export const publicClient = createPublicClient({
  chain: celo,
  transport: http(ENV.rpcUrl),
  pollingInterval: 1000,
});

// EVERY transaction sent through this client carries the hackathon attribution tag (ERC-8021).
export const walletClient = createWalletClient({
  account,
  chain: celo,
  transport: http(ENV.rpcUrl),
}).extend(withAttribution(ENV.attribution));

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
export const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

// ---- single-writer queue: all wallet sends are serialized so nonces never collide ----
let tail: Promise<unknown> = Promise.resolve();
export function enqueue<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch((e) => console.error(`[tx-queue] ${label} failed:`, (e as Error).message));
  return run;
}

export interface Sent { hash: Hex; blockNumber: bigint }

async function waitOk(hash: Hex): Promise<Sent> {
  const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return { hash, blockNumber: r.blockNumber };
}

export function sendTransfer(token: Address, to: Address, amount: bigint, label = "transfer"): Promise<Sent> {
  return enqueue(label, async () => {
    const hash = await walletClient.writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
    return waitOk(hash);
  });
}

export function sendApprove(token: Address, spender: Address, amount: bigint, label = "approve"): Promise<Sent> {
  return enqueue(label, async () => {
    const hash = await walletClient.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
    return waitOk(hash);
  });
}

export function sendRaw(tx: { to: Address; data: Hex; value?: bigint }, label = "raw"): Promise<Sent> {
  return enqueue(label, async () => {
    const hash = await walletClient.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n });
    return waitOk(hash);
  });
}

export async function balanceOf(token: Address, who: Address = AGENT): Promise<bigint> {
  return publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}
export async function allowanceOf(token: Address, spender: Address): Promise<bigint> {
  return publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [AGENT, spender] });
}
export async function celoBalance(): Promise<bigint> {
  return publicClient.getBalance({ address: AGENT });
}

export const fmt = (v: bigint, dec: number) => Number(formatUnits(v, dec));

/** Find ERC-20 Transfer logs into the agent wallet since a block. */
export async function incomingTransfers(token: Address, fromBlock: bigint) {
  return publicClient.getLogs({
    address: token,
    event: transferEvent,
    args: { to: AGENT },
    fromBlock,
    toBlock: "latest",
  });
}
