# Puente

**Pay a person in Argentina, Brazil or Colombia in the money they spend, with one HTTP call. No bank, no account, no custody pool.**

Built solo for the *Agents on Open Rails* hackathon (Celo x Loops House). Live app: https://puente-agent-production-bb67.up.railway.app · Agent: ERC-8004 #10055 · Tag: `celo_eabed0a00299`

## The problem
Someone paid from abroad in Argentina, Brazil or Colombia needs a bank, an account and several fee layers, and an **AI agent or software service cannot pay a human there at all** without a person in the loop. Puente makes that last mile a single x402 payment: the payer settles in USA₮, USD₮ or USDC and the recipient ends up holding the currency they actually spend (Ripio wARS / wBRL / wCOP). It needs three Celo pieces together: **x402** (machine-payable HTTP), **Textile FX** (firm, non-custodial FX quotes) and **Ripio wFIAT** (1:1 local-currency stablecoins).

## How it works
```
payer --x402 (USA₮/USD₮/USDC, gasless)--> Puente agent wallet
  payout worker waits to SEE the payer's Transfer onchain (the HTTP handler never pays)
  -> firm Textile RFQ swap funded by that payment -> wARS/wBRL/wCOP transfer to the recipient
  failure after payment -> automatic refund (same token, or the local currency if already swapped)
```
1. `POST /v1/orders` returns a 60-second quote: exact local amount, fee, and a price carrying a unique micro-fingerprint.
2. `POST /v1/pay?order=<id>` is protected by x402 with a **dynamic per-order price** in three tokens.
3. The payout worker matches one onchain Transfer to exactly one order, then swaps and pays out. Payer, recipient, amounts and tx hashes are public.
4. Every transaction we send carries the ERC-8004/ERC-8021 attribution tag via `withAttribution` on the viem wallet client; Textile swaps also request it (`builderCodes`).

## Evidence (all on Celo mainnet, agent wallet `0x492D…e63B`)
| What | Proof |
|---|---|
| ERC-8004 identity #10055 + agentURI to the live `/agent.json` | [register](https://celoscan.io/tx/0x6b29f4248ed82708acc7bfc848cb5ddfcfba36a7a7f7f97fe77599b102b80b6d), [setAgentURI](https://celoscan.io/tx/0x84073ff136b42e1c5eca49aa862bee48c7b63f61e1309d3c912c9db4c7f7f0c8) |
| Textile FX firm RFQ swap with keyless proof-of-control, tagged | [tx](https://celoscan.io/tx/0xddbe8b49433d43bd5491a15e0a1ae96aadb30fe746a2ecd16956b2b6f0c41a34) |
| Paid buy calls (Chainstack RPC, Cencori) | [docs/buy-proof.md](docs/buy-proof.md) (3 calls, settlement hashes) |
| x402 settlement through Celo's facilitator into the PayTo wallet, matched onchain in 9.8 s | [tx](https://celoscan.io/tx/0x042c202765cf2698bfe9d92ed6e7c06fc9325819bf1b56f46f6cb63130922f3b) (our own test payer) |
| All of the above re-read independently via a paid batched call | [docs/proof-verification.md](docs/proof-verification.md) |

## Engineering
- **20 end-to-end tests** (`npm test`) run the real production modules against an in-memory simulated chain and Textile venue (`src/sim.ts`, `SIM=1`, never set in production): quote math and unique fingerprints, validation and caps, the full paid-order flow in USDT and USA₮, double-spend and false-match protection, expiry, both refund paths, venue-outage refunds, treasury rate guard / exposure cap / consolidation / P&L, buy budget caps, the HTTP API and the x402 402-challenge, NL parsing, the ERC-8004 file and attribution suffix. CI runs typecheck + tests.
- **Safety by design:** payout only after an observed onchain Transfer; per-order price fingerprint; per-IP rate limits; order caps ($1.25 to $5); daily outflow cap; kill switch (`PAUSED=1`); capped token approvals; single-writer transaction queue.
- Strict TypeScript, pinned dependencies, install scripts disabled, secrets only in environment variables.

## Where each track is implemented
See [docs/JUDGING_MAP.md](docs/JUDGING_MAP.md) for each track's criteria mapped to code, tests and mainnet evidence.

## Verification status
Mainnet-verified: the rows in the Evidence table. Verified in simulation (not on mainnet): the swap-from-order, local-currency payout, refund paths and treasury strategy. Not yet observed: an order paid by an independent user. The treasury float strategy is implemented and disabled in this deployment (`TREASURY_AUTO=0`); payouts run in zero-capital mode, where each order's payment funds its own swap.

## Run locally
```bash
npm install --ignore-scripts
npm run wallet:new && npm run build:web && npm start
npm test
```
Env: `AGENT_PRIVATE_KEY`, `X402_API_KEY`, `ATTRIBUTION_CODE`, `PUBLIC_URL`, `DATA_DIR`, `AGENT_ID`, `LEAN`, `TREASURY_AUTO`.

## Known limitations
An exact-amount transfer arriving after its order fully expired needs manual review. Order records are a JSON file on a volume (a database is next). The hot wallet key is held in the host environment, so balances are kept tiny; there is no independent audit. Textile allows 4 open firm quotes per key/IP and about $1 minimum swap, hence the small order sizes. Hackathon prototype, not a licensed money transmitter.
