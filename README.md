# Puente

**Send dollars, they receive pesos or reais on Celo. An agent does the swap and the payout, and refunds you if anything fails.**

Built solo for the *Agents on Open Rails* hackathon (Celo x Loops House), with almost no funds. Code written during the hackathon. Live: https://puente-agent-production-bb67.up.railway.app

A payer (a person or any x402 agent) pays an order in **USA₮, USD₮ or USDC over x402**. Puente's agent waits until it can see that payment **onchain**, swaps it through **Textile FX** into **Ripio wARS / wBRL / wCOP**, and sends those to the recipient. If the payout fails, the payer is refunded automatically. It buys chain reads and inference through **buy**, has an **ERC-8004** identity, and tags every transaction with the hackathon attribution code.

## Status: what is verified and what is not (read this first)
Verified with real mainnet transactions (see [docs/PROOF.md](docs/PROOF.md)): ERC-8004 registration (agent #10055), a Textile FX firm swap with keyless proof-of-control and our tag, and two paid buy calls (Chainstack, Cencori) with settlement hashes ([docs/buy-proof.md](docs/buy-proof.md)).

Implemented and deployed but **not yet exercised by a real paid order**: the x402 settlement into our PayTo wallet, the wARS/wBRL/wCOP payout, and the refund path. No outside user has paid yet. A treasury mode (float, rate guard, decision log at `/agent/log`) is implemented but **disabled** (`TREASURY_AUTO=0`) because we have almost no capital; payouts instead run in zero-capital mode, where each order's own payment funds its own swap.

## Tracks
| Track | What exists |
|---|---|
| Stable Agents: LatAm (Ripio) | Payout in wARS/wBRL/wCOP implemented; Ripio off-ramp link in the receipt; ES/PT/EN UI. Not yet run with a real order. |
| Open Corridors: Textile FX | Real firm RFQ swap done on mainnet (tagged). Treasury strategy implemented, disabled. Tiny volume. |
| Open Corridors: USA₮ with x402 | x402 seller with a dynamic per-order price in USA₮/USD₮/USDC is live (the 402 challenge works). No settled outside payment yet. |
| Build with buy | Two real paid calls made. Each payout also runs a paid Chainstack batch check (non-fatal if it fails). |

## How it works
```
payer --x402 (USA₮/USD₮/USDC, gasless)--> Puente wallet
  payout worker waits to SEE the payer's Transfer onchain (the HTTP handler never pays)
  -> Textile firm RFQ swap funded by that payment -> wARS/wBRL/wCOP transfer to recipient
  failure after payment -> automatic refund
```
1. `POST /v1/orders` creates a 60-second quote (fee 1%, min $0.05; $1.25 to $5 during the hackathon).
2. `POST /v1/pay?order=<id>` is protected by x402 with a **dynamic price** and three accepted tokens.
3. The price carries a tiny unique fingerprint, so the worker matches one onchain Transfer to exactly one order.
4. After three failed payout attempts the payer is refunded (same token, or USDT if the payment was already converted).

## Verify it yourself
- Attribution tag `celo_eabed0a00299` is applied by `withAttribution` on the viem wallet client (`src/chain.ts`) and requested from Textile (`builderCodes`). Check any hash with `verifyTx`.
- Agent wallet and x402 PayTo (same address): `0x492DC215C8b7C88c5747ac79EFA5d4Eb894ae63B`. Agent id: 10055 (`/agent.json`).
- `/stats` and `/agent/log` are public.

## Architecture
`src/server.ts` API + x402 seller · `src/orders.ts` quotes · `src/payout.ts` onchain-confirmed payouts and refunds · `src/treasury.ts` just-in-time fill and (disabled) float agent · `src/textile.ts` Textile RFQ v2 client · `src/buy.ts` paid buy calls · `src/identity.ts` ERC-8004 · `web/` browser UI · `scripts/` real-money smoke tests.

## Run locally
```bash
npm install --ignore-scripts
npm run wallet:new      # creates the agent wallet in .env (git-ignored)
npm run build:web && npm start
npm run t1-celo         # (scripts/t1-celo-swap.ts) real Textile swap
```
Env: `AGENT_PRIVATE_KEY`, `X402_API_KEY`, `ATTRIBUTION_CODE`, `PUBLIC_URL`, `DATA_DIR`, `AGENT_ID`, `LEAN`, `TREASURY_AUTO`.

## Limits and honesty
Hackathon prototype on Celo mainnet with small limits. Not a licensed money transmitter. Gas for payers is paid by the x402 facilitator and is not claimed as our contribution.
