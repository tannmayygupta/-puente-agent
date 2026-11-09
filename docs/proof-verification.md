# Proof verification (one paid, batched Chainstack call through buy)

Verified at 2026-11-09T08:33:43.942Z by reading each receipt from Celo mainnet through the buy gateway (Chainstack, $0.01).

| What | Tx | Receipt status | Block |
|---|---|---|---|
| ERC-8004 register (agent #10055) | [0x6b29f4248e...](https://celoscan.io/tx/0x6b29f4248ed82708acc7bfc848cb5ddfcfba36a7a7f7f97fe77599b102b80b6d) | success | 82269391 |
| ERC-8004 setAgentURI | [0x84073ff136...](https://celoscan.io/tx/0x84073ff136b42e1c5eca49aa862bee48c7b63f61e1309d3c912c9db4c7f7f0c8) | success | 82308050 |
| Textile FX swap 1.65 CELO -> USDT | [0xddbe8b4943...](https://celoscan.io/tx/0xddbe8b49433d43bd5491a15e0a1ae96aadb30fe746a2ecd16956b2b6f0c41a34) | success | 82309140 |
| buy: Chainstack call settlement | [0x4ebecec236...](https://celoscan.io/tx/0x4ebecec236a5502dc3f509630cfd11e81d8a844bb62f5311defe9c0a3a032f71) | success | 82309166 |
| buy: Cencori call settlement | [0x18ffdcf4b1...](https://celoscan.io/tx/0x18ffdcf4b1ec87f76aeebba17b838395bc1b1bfdb0b9b177be9cf22cadd7b787) | success | 82309169 |
| x402 self-test settlement (not an independent user) | [0x042c202765...](https://celoscan.io/tx/0x042c202765cf2698bfe9d92ed6e7c06fc9325819bf1b56f46f6cb63130922f3b) | success | 82310270 |
