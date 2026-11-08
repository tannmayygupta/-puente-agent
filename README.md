# Puente

**Send dollars, they receive pesos or reais. An autonomous treasury agent does the rest, on Celo mainnet.**

Built for the *Agents on Open Rails* hackathon (Celo × Loops House). Code written during the hackathon.

A payer settles in **USA₮, USD₮ or USDC over x402**. Puente's agent sees the payment onchain and pays the recipient in **Ripio wARS / wBRL / wCOP** from its own float in seconds. In the background it refills that float on **Textile FX** only when the rate is good. It buys chain data and inference through **buy**, and it has an **ERC-8004** identity. Every transaction carries the hackathon attribution tag.

## Tracks
| Track | What Puente does |
|---|---|
| Stable Agents: LatAm (Ripio) | Real wFIAT payouts (wARS, wBRL, wCOP) to the recipient; Ripio off-ramp link in the receipt; ES/PT/EN UI |
| Open Corridors: Textile FX | Treasury agent: float targets, rate guard vs a 30-minute window, batched refills, exposure caps, public decision log and P&L |
| Open Corridors: USA₮ with x402 | Orders are paid over Celo's x402 facilitator in USA₮ (also USD₮/USDC) with a dynamic per-order price |
| Build with buy | Every payout makes paid calls through the buy gateway: batched Celo RPC checks (Chainstack) and natural-language parsing (Cencori) |

## How it works
```
payer --x402 (USA₮/USD₮/USDC, gasless)--> Puente (wallet T)
                                            |  payout worker waits to SEE the payer's Transfer onchain
                                            v
                         wARS/wBRL/wCOP transfer from float --> recipient
treasury loop (every 30s): sample Textile rates -> decide refill/hold/wait -> firm RFQ swap (tagged) -> log decision
```
1. `POST /v1/orders` creates a 60-second quote (exact price, fee 1% min $0.10, $2 to $25).
2. `POST /v1/pay?order=<id>` is protected by x402 with a **dynamic price** and three accepted tokens.
3. The HTTP handler never pays out. The **payout worker pays only after it observes the Transfer log** (the price carries a tiny unique fingerprint so each order matches exactly one payment). If the payout fails three times the payer is refunded in the same token.
4. The **treasury agent** keeps a small float per currency and refills it from Textile with a rate guard, then consolidates collected USA₮/USDC into USDT in batches. Every decision (act or wait) is public at `/agent/log`; stats and P&L at `/stats`.

## Verify it yourself
- Attribution tag: `celo_eabed0a00299` on every transaction we send (`withAttribution` on the viem wallet client in `src/chain.ts`; Textile swaps also request the tag via `builderCodes`). Check any tx hash with `verifyTx` from `@celo/attribution-tags`.
- x402 PayTo and sender wallet (same address): `0x492DC215C8b7C88c5747ac79EFA5d4Eb894ae63B`
- Agent identity (ERC-8004): see `/agent.json` and `/api/config` for the agent id.
- `/stats` (volumes, P&L, buy spend, unique payers), `/agent/log` (agent decisions), `docs/buy-proof.md` (paid buy calls with settlement hashes).

## Architecture
`src/server.ts` API + x402 seller · `src/orders.ts` quotes · `src/payout.ts` onchain-confirmed payouts and refunds · `src/treasury.ts` float agent · `src/textile.ts` Textile RFQ v2 client (takerProof signing, firm quotes, tagged swaps) · `src/buy.ts` paid buy calls · `src/identity.ts` ERC-8004 · `web/` browser UI (wallet, x402 signing) · `scripts/` smoke tests.

## Run locally
```bash
npm install --ignore-scripts
cp .env.example .env          # or: npm run wallet:new  (creates the agent wallet in .env)
npm run build:web
npm start                     # http://localhost:3000
npm run status                # balances and rates
npm run t1 -- --live 1.2 ARS  # one real Textile swap from the agent wallet
npm run t2 -- 2 ARS USDT      # act as an outside payer (needs BUYER_PRIVATE_KEY)
```
Env: `AGENT_PRIVATE_KEY`, `X402_API_KEY` (x402.celo.org), `ATTRIBUTION_CODE`, `PUBLIC_URL`, `DATA_DIR`, `AGENT_ID`.

## Money model and limits
Fee 1% (min $0.10); orders $2 to $25; quote valid 60 s; float target $8 / low $3 / cap $15 per currency; daily outflow cap $150; kill switch `PAUSED=1`. Gas for payers is paid by the x402 facilitator (not counted as our contribution). This is a hackathon prototype with small limits, not a licensed money transmitter.
