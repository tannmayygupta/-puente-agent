import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { getAddress, type Address } from "viem";

dotenv.config();
// Render "Secret Files" are mounted here: lets us deploy by pasting .env once, with no per-variable typing
if (existsSync("/etc/secrets/.env")) dotenv.config({ path: "/etc/secrets/.env" });
// hosting dashboards/CLIs sometimes append a newline or spaces to secret values: always trim
for (const k of Object.keys(process.env)) { const v = process.env[k]; if (typeof v === "string" && v !== v.trim()) process.env[k] = v.trim(); }

export const ENV = {
  port: Number(process.env.PORT ?? 3000),
  rpcUrl: process.env.CELO_RPC_URL ?? "https://forno.celo.org",
  attribution: process.env.ATTRIBUTION_CODE ?? "celo_eabed0a00299",
  dataDir: process.env.DATA_DIR ?? "./data",
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:3000",
  facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://api.x402.celo.org",
  paused: () => process.env.PAUSED === "1",
};

export function agentKey(): `0x${string}` {
  const k = process.env.AGENT_PRIVATE_KEY;
  if (!k) throw new Error("AGENT_PRIVATE_KEY missing in .env (run `npm run wallet:new`)");
  return (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
}

export const CHAIN_ID = 42220;
export const CAIP2 = "eip155:42220" as const;

export interface Stable {
  symbol: "USAT" | "USDT" | "USDC";
  address: Address;
  decimals: 6;
  /** EIP-712 domain used by x402 (NOT the ticker) */
  x402: { name: string; version: string };
}

export const STABLES: Record<Stable["symbol"], Stable> = {
  USAT: { symbol: "USAT", address: getAddress("0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771"), decimals: 6, x402: { name: "Tether America USD", version: "1" } },
  USDT: { symbol: "USDT", address: getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"), decimals: 6, x402: { name: "Tether USD", version: "1" } },
  USDC: { symbol: "USDC", address: getAddress("0xcebA9300f2b948710d2653dD7B07f33A8B32118C"), decimals: 6, x402: { name: "USDC", version: "2" } },
};
export const STABLE_LIST = [STABLES.USAT, STABLES.USDT, STABLES.USDC];

export type CurrencyCode = "ARS" | "BRL" | "COP" | "MXN";
export interface Local {
  code: CurrencyCode;
  symbol: string;
  address: Address;
  decimals: 18;
  country: string;
  name: string;
  /** decimals shown/paid out (rounded down) */
  payoutDp: number;
}
export const LOCALS: Record<CurrencyCode, Local> = {
  ARS: { code: "ARS", symbol: "wARS", address: getAddress("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D"), decimals: 18, country: "AR", name: "Argentine peso", payoutDp: 2 },
  BRL: { code: "BRL", symbol: "wBRL", address: getAddress("0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0"), decimals: 18, country: "BR", name: "Brazilian real", payoutDp: 2 },
  COP: { code: "COP", symbol: "wCOP", address: getAddress("0x8a1D45e102e886510e891d2Ec656a708991e2D76"), decimals: 18, country: "CO", name: "Colombian peso", payoutDp: 0 },
  MXN: { code: "MXN", symbol: "wMXN", address: getAddress("0x337E7456B420bD3481e7FA61fA9850343d610d34"), decimals: 18, country: "MX", name: "Mexican peso", payoutDp: 2 },
};
export const ACTIVE_CURRENCIES: CurrencyCode[] = ["ARS", "BRL", "COP"];
// (DRY_RUN overrides are applied right after PARAMS below) // MXN only when makers are online (checked at runtime)

export const CELO_TOKEN = getAddress("0x471EcE3750Da237f93B8E339c536989b8978a438");
export const TEXTILE_REACTOR = getAddress("0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3");

/** Locked business parameters (see PLAN.md section 5) */
export const PARAMS: Record<string, number> = {
  feePct: 0.01,
  feeMinUsd: 0.1,
  orderMinUsd: 2,
  orderMaxUsd: 25,
  quoteValiditySec: 60,
  payerWaitSec: 120, // how long after expiry we still look for a payment
  floatTargetUsd: 8,
  floatLowUsd: 3,
  floatCriticalUsd: 1.5,
  floatCapUsd: 15,
  totalFloatCapUsd: 30,
  usdBufferUsd: 10,
  refillMinUsd: 5, // Textile min firm size is about $1; we batch >= $5
  consolidateMinUsd: 5,
  guardBps: 5, // refill when rate within 5 bps of 30-min best
  maxWaitMin: 20,
  approvalCapUsd: 100,
  jitSlippageBps: 30,
  quotesPerMinPerIp: 10,
  openUnpaidPerIp: 3,
  dailyOutflowCapUsd: 150,
};

// DRY_RUN=1 (LOCAL TESTING ONLY, never on the live server): tiny orders; after the payment is confirmed onchain the
// payout/swap is skipped. Lets us test x402 settlement + onchain detection with cents that just move between our own wallets.
export const DRY_RUN = process.env.DRY_RUN === "1";

// LEAN=1: run the whole product on about $5-10 of capital (tiny floats, small orders). Same logic, smaller numbers.
if (process.env.LEAN === "1") {
  Object.assign(PARAMS, {
    feeMinUsd: 0.05, orderMinUsd: 1.25, orderMaxUsd: 5,
    floatTargetUsd: 2.5, floatLowUsd: 1.2, floatCriticalUsd: 0.6, floatCapUsd: 5, totalFloatCapUsd: 8,
    refillMinUsd: 1.1, consolidateMinUsd: 1.1, approvalCapUsd: 20, dailyOutflowCapUsd: 40,
  });
}
if (DRY_RUN) {
  Object.assign(PARAMS, { orderMinUsd: 0.04, orderMaxUsd: 1, feePct: 0, feeMinUsd: 0 });
  console.warn("[DRY_RUN] orders are tiny and payouts are SKIPPED. Never run this on the live server.");
}
