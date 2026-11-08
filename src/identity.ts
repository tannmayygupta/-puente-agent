// ERC-8004 agent identity for Puente (Celo mainnet Identity Registry).
import { getAddress, parseAbi, parseEventLogs, type Hex } from "viem";
import { AGENT, enqueue, publicClient, walletClient } from "./chain.js";
import { CAIP2, ENV } from "./config.js";

export const IDENTITY_REGISTRY = getAddress("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
export const REPUTATION_REGISTRY = getAddress("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63");

export const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export function registrationFile(agentId?: string | number) {
  const base = ENV.publicUrl.replace(/\/$/, "");
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Puente",
    description:
      "Autonomous cross-border payment agent on Celo. Pay in USA₮/USD₮/USDC over x402 and the recipient receives Ripio wARS/wBRL/wCOP within seconds. A treasury agent holds local-currency float and refills it from Textile FX at guarded rates; it buys chain data and inference through buy.",
    image: `${base}/logo.svg`,
    services: [
      { name: "web", endpoint: base },
      { name: "x402", endpoint: `${base}/v1/pay`, version: "2" },
      { name: "OpenAPI-lite", endpoint: `${base}/api/config` },
    ],
    x402Support: true,
    active: true,
    supportedTrust: ["reputation"],
    payTo: AGENT,
    attributionTag: ENV.attribution,
    ...(agentId !== undefined
      ? { registrations: [{ agentId: Number(agentId), agentRegistry: `${CAIP2}:${IDENTITY_REGISTRY}` }] }
      : {}),
  };
}

export const toDataUri = (obj: unknown) =>
  "data:application/json;base64," + Buffer.from(JSON.stringify(obj)).toString("base64");

export async function register(uri: string): Promise<{ agentId: bigint; hash: Hex }> {
  const hash = await enqueue("erc8004-register", () =>
    walletClient.writeContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: "register", args: [uri] }));
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("register reverted");
  const [ev] = parseEventLogs({ abi: identityAbi, eventName: "Registered", logs: receipt.logs });
  if (!ev) throw new Error("Registered event not found");
  return { agentId: ev.args.agentId, hash };
}

export async function setAgentURI(agentId: bigint, uri: string): Promise<Hex> {
  const hash = await enqueue("erc8004-setURI", () =>
    walletClient.writeContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: "setAgentURI", args: [agentId, uri] }));
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
