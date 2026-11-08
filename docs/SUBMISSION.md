# Submission draft (paste into the loops.house form)

**Project name:** Puente

**One-line:** Send dollars, they receive pesos or reais on Celo in seconds. An autonomous treasury agent does the rest.

**Description (Step 1):**
Puente is a cross-border payment agent on Celo mainnet. A payer (a person or any x402 agent) pays in USA₮, USD₮ or USDC over x402. Puente's agent waits until it can SEE that payment onchain, then pays the recipient in Ripio wARS, wBRL or wCOP from its own pre-funded float, so the recipient is paid in seconds. If anything fails after payment, the payer is refunded automatically in the same token.

In the background a treasury agent keeps that float funded: it samples Textile FX rates, decides whether to refill, wait or skip (rate guard against a 30-minute window, size limits, exposure caps), and executes firm RFQ swaps. Every decision is public at /agent/log and the P&L is public at /stats.

Who it is for: people and businesses that need to pay someone in Argentina, Brazil or Colombia in the money they actually spend, without a bank or an account. Agents can use it too: any x402 client can create an order and pay it over plain HTTP.

How it uses the Celo stack: ERC-8004 agent identity (agent #10055), x402 payments through Celo's facilitator with a dynamic per-order price, Ripio wFIAT stablecoins, Textile FX, gas in stablecoins, and buy for paid third-party calls. Every transaction carries the attribution tag celo_eabed0a00299.

**Tracks entered:** Stable Agents LatAm (Ripio), Open Corridors Textile FX, Open Corridors USA₮ with x402, Build with buy.

**Agent wallet / PayTo:** 0x492DC215C8b7C88c5747ac79EFA5d4Eb894ae63B (same wallet sends all tagged transactions and receives all x402 payments)

**ERC-8004:** agent id 10055 (Celo mainnet Identity Registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432)

**Repo:** https://github.com/tannmayygupta/-puente-agent

**Live app:** <fill in after deploy>

**Build with buy proof:** docs/buy-proof.md in the repo (services: Chainstack Celo RPC, Cencori chat; settlement tx hashes listed)

**Architecture notes (gas / sponsored transactions):** payer gas is paid by the Celo x402 facilitator (EIP-3009 gasless for USDC/USD₮/USA₮); that gas is not claimed as our contribution. Our own transactions are paid by wallet T.

**Where users and volume came from:** <fill in honestly: hackathon Telegram builders, reciprocal testing, named LatAm recipient>. Our own test wallets are not counted as independent users.
