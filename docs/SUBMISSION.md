# Submission draft (paste into the loops.house form)

**Project name:** Puente

**One-line:** Send dollars, they receive pesos or reais on Celo in seconds. An autonomous agent does the rest.

**Description (Step 1):**
Puente is a cross-border payment agent on Celo mainnet. A payer (a person, or any x402 agent) pays in USA₮, USD₮ or USDC over x402 at an exact per-order price. Puente's agent waits until it can SEE that payment onchain (it never trusts the HTTP handler), then pays the recipient in Ripio wARS, wBRL or wCOP. The swap behind each payout is a real Textile FX firm quote, funded by the order's own payment, so Puente needs no capital of its own. If anything fails after payment, the payer is refunded automatically.

A treasury mode is also built (public decision log at /agent/log, P&L at /stats): it can keep a small float of local stablecoins and refill it from Textile only when the rate is within a guard band of the 30-minute best. It is switched off in this deployment because we ran with almost no capital.

Who it is for: people and businesses that need to pay someone in Argentina, Brazil or Colombia in the money they actually spend, without a bank or an account. Agents can use it too: any x402 client can create an order and pay it over plain HTTP.

How it uses the Celo stack: ERC-8004 agent identity (agent #10055), x402 payments through Celo's facilitator with a dynamic per-order price, Ripio wFIAT stablecoins, Textile FX (keyless firm quotes with a signed proof of control), and buy for paid third-party calls. Every transaction we send carries the attribution tag celo_eabed0a00299.

**Tracks entered:** Stable Agents LatAm (Ripio), Open Corridors Textile FX, Open Corridors USA₮ with x402, Build with buy.

**Agent wallet / PayTo:** 0x492DC215C8b7C88c5747ac79EFA5d4Eb894ae63B (the same wallet sends all tagged transactions and receives all x402 payments)

**ERC-8004:** agent id 10055 (Celo mainnet Identity Registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432), agentURI points to the live /agent.json

**Repo:** https://github.com/tannmayygupta/-puente-agent

**Live app:** https://puente-agent-production-bb67.up.railway.app

**Build with buy proof:** docs/buy-proof.md in the repo (services: Chainstack Celo RPC, Cencori chat; settlement tx hashes listed once calls are made)

**Architecture notes (gas / sponsored transactions):** payer gas is paid by the Celo x402 facilitator (EIP-3009, gasless for USDC/USD₮/USA₮); that gas is not claimed as our contribution. Our own transactions are paid by the agent wallet.

**Honest status:** built and deployed by a solo developer in the hackathon window with almost no funds. <fill in at submission time: how many real mainnet transactions and independent payers exist, with links>. Our own test wallets are not counted as independent users.
