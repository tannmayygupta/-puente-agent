# Build with buy: proof of paid calls

Payer wallet (tagged agent wallet): `0x492DC215C8b7C88c5747ac79EFA5d4Eb894ae63B`
Gateway: https://gateway.usebuy.ai (x402 on Celo mainnet)

Total paid calls: **3** - total spend: **$0.030**

| Service | Calls | USD |
|---|---|---|
| chainstack.celo | 2 | $0.020 |
| cencori.chat | 1 | $0.010 |

## Calls
| Time (UTC) | Service | USD | Settlement tx |
|---|---|---|---|
| 2026-11-09T07:38:45.000Z | chainstack.celo | $0.010 | [0x4ebecec236...](https://celoscan.io/tx/0x4ebecec236a5502dc3f509630cfd11e81d8a844bb62f5311defe9c0a3a032f71) |
| 2026-11-09T07:38:57.839Z | cencori.chat | $0.010 | [0x18ffdcf4b1...](https://celoscan.io/tx/0x18ffdcf4b1ec87f76aeebba17b838395bc1b1bfdb0b9b177be9cf22cadd7b787) |
| 2026-11-09T08:33:43.815Z | chainstack.celo | $0.010 | [0x51c5556c24...](https://celoscan.io/tx/0x51c5556c2443d350de1bcb11a84ebae2e9a09e1781272c964c06e993f2b8bbe2) |

Why each call exists: every payout runs one batched Celo RPC call (Chainstack) to pre-check the recipient and post-verify the payout, and natural-language orders are parsed by Cencori. Spend is capped per call and per day.