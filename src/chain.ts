import { createPublicClient, createWalletClient, getAddress, http, parseAbi, parseAbiItem, formatUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { withAttribution } from "@celo/attribution-tags";
import { ENV, agentKey } from "./config.js";
import { SIM, sim } from "./sim.js";

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

// ---- gas: pay in CELO when we have some, otherwise in USDT through Celo's fee-abstraction adapter ----
// (adapter verified onchain: "Tether USD", 18 decimals). Override with GAS_IN=CELO|USDT.
export const USDT_GAS_ADAPTER: Address = getAddress("0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72");
const USDT_TOKEN: Address = getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e");
let feeCache: { t: number; v: Address | undefined } | null = null;
export async function gasOpts(): Promise<{ feeCurrency?: Address }> {
  if (SIM || process.env.GAS_IN === "CELO") return {};
  if (feeCache && Date.now() - feeCache.t < 20_000) return feeCache.v ? { feeCurrency: feeCache.v } : {};
  let v: Address | undefined;
  const celoBal = await publicClient.getBalance({ address: AGENT });
  if (process.env.GAS_IN === "USDT" || celoBal < 50_000_000_000_000_000n /* 0.05 CELO */) {
    const usdt = await publicClient.readContract({ address: USDT_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [AGENT] });
    if (usdt >= 50_000n /* $0.05 */) v = USDT_GAS_ADAPTER;
  }
  feeCache = { t: Date.now(), v };
  return v ? { feeCurrency: v } : {};
}

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
  if (SIM) return enqueue(label, async () => { const hash = sim.transfer(token, AGENT, to, amount); return { hash, blockNumber: sim.block }; });
  return enqueue(label, async () => {
    const hash = await walletClient.writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [to, amount], ...(await gasOpts()) } as never);
    return waitOk(hash);
  });
}

export function sendApprove(token: Address, spender: Address, amount: bigint, label = "approve"): Promise<Sent> {
  if (SIM) return enqueue(label, async () => { sim.allow.set(`${token}|${spender}`.toLowerCase(), amount); return { hash: sim.hash(), blockNumber: sim.block }; });
  return enqueue(label, async () => {
    const hash = await walletClient.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount], ...(await gasOpts()) } as never);
    return waitOk(hash);
  });
}

export function sendRaw(tx: { to: Address; data: Hex; value?: bigint }, label = "raw"): Promise<Sent> {
  return enqueue(label, async () => {
    const hash = await walletClient.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n, ...(await gasOpts()) } as never);
    return waitOk(hash);
  });
}

export async function balanceOf(token: Address, who: Address = AGENT): Promise<bigint> {
  if (SIM) return sim.get(token, who);
  return publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}
export async function allowanceOf(token: Address, spender: Address): Promise<bigint> {
  if (SIM) return sim.allow.get(`${token}|${spender}`.toLowerCase()) ?? 0n;
  return publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [AGENT, spender] });
}
export async function celoBalance(): Promise<bigint> {
  if (SIM) return 10n ** 18n;
  return publicClient.getBalance({ address: AGENT });
}

export async function currentBlock(): Promise<bigint> {
  if (SIM) return sim.block;
  return publicClient.getBlockNumber();
}

/** Dry-run an exact transaction (eth_call). No-op in the simulation. */
export async function dryRunCall(tx: { to: Address; data: Hex; value?: bigint }): Promise<void> {
  if (SIM) return;
  await publicClient.call({ account: AGENT, to: tx.to, data: tx.data, value: tx.value ?? 0n });
}

export const fmt = (v: bigint, dec: number) => Number(formatUnits(v, dec));

/** Find ERC-20 Transfer logs into the agent wallet since a block. */
export async function incomingTransfers(token: Address, fromBlock: bigint) {
  if (SIM) return sim.logs.filter((l) => l.address.toLowerCase() === token.toLowerCase() && l.args.to.toLowerCase() === AGENT.toLowerCase() && l.blockNumber >= fromBlock) as never[];
  return publicClient.getLogs({
    address: token,
    event: transferEvent,
    args: { to: AGENT },
    fromBlock,
    toBlock: "latest",
  });
}
