# Proof of real Celo mainnet activity (agent wallet `0x492DC215C8b7C88c5747ac79EFA5d4Eb894ae63B`)

Everything below is a real transaction. Nothing is simulated. Every transaction we send carries the attribution tag `celo_eabed0a00299` (verified with `verifyTx` from `@celo/attribution-tags`).

| What | Transaction |
|---|---|
| ERC-8004 identity registered, agent id **10055** | [0x6b29f424...](https://celoscan.io/tx/0x6b29f4248ed82708acc7bfc848cb5ddfcfba36a7a7f7f97fe77599b102b80b6d) |
| ERC-8004 agentURI set to the live `/agent.json` | [0x84073ff1...](https://celoscan.io/tx/0x84073ff136b42e1c5eca49aa862bee48c7b63f61e1309d3c912c9db4c7f7f0c8) |
| Textile FX firm RFQ swap, 1.65 CELO -> 0.103629 USDT (keyless takerProof, tagged) | [0xddbe8b49...](https://celoscan.io/tx/0xddbe8b49433d43bd5491a15e0a1ae96aadb30fe746a2ecd16956b2b6f0c41a34) |
| buy: paid Chainstack Celo RPC call ($0.01) | [0x4ebecec2...](https://celoscan.io/tx/0x4ebecec236a5502dc3f509630cfd11e81d8a844bb62f5311defe9c0a3a032f71) |
| buy: paid Cencori chat completion ($0.01) | [0x18ffdcf4...](https://celoscan.io/tx/0x18ffdcf4b1ec87f76aeebba17b838395bc1b1bfdb0b9b177be9cf22cadd7b787) |

| x402 self-test: 5-cent order paid by our OWN test wallet `0xA9FD...806F` over x402 (USDT, gasless EIP-3009), settled by Celo's facilitator into the PayTo wallet; the payout worker matched the onchain Transfer to the order in 9.8 s (local DRY_RUN mode: swap and payout skipped). **Not an independent user.** | [0x042c2027...](https://celoscan.io/tx/0x042c202765cf2698bfe9d92ed6e7c06fc9325819bf1b56f46f6cb63130922f3b) |

## Honest status of what has NOT happened yet
- No outside user has paid an order through Puente yet. The x402 settlement into our PayTo wallet was verified only as a self-test between our own wallets (row above). There has been no wARS/wBRL/wCOP payout and no refund on mainnet yet (they need at least about $1.3 of real value because Textile's minimum swap is about $1). The code paths are written and type-checked, but a full paid order including the swap and payout has not run.
- The treasury/float strategy (rate guard, refills, decision log) is implemented but disabled in this deployment (`TREASURY_AUTO=0`) because the wallet holds almost no capital. Payouts run in zero-capital mode: the order's own payment funds its own Textile swap.
- Independent users: none so far.
