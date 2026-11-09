# Build with buy: proof of paid calls

Payer wallet (tagged agent wallet): `0x492DC215C8b7C88c5747ac79EFA5d4Eb894ae63B`
Gateway: https://gateway.usebuy.ai (x402 on Celo mainnet)

Total paid calls: **1** - total spend: **$0.010**

| Service | Calls | USD |
|---|---|---|
| chainstack.celo | 1 | $0.010 |

## Calls
| Time (UTC) | Service | USD | Settlement tx |
|---|---|---|---|
| 2026-11-09T07:38:45.000Z | chainstack.celo | $0.010 | [0x4ebecec236...](https://celoscan.io/tx/0x4ebecec236a5502dc3f509630cfd11e81d8a844bb62f5311defe9c0a3a032f71) |

Why each call exists: every payout runs one batched Celo RPC call (Chainstack) to pre-check the recipient and post-verify the payout, and natural-language orders are parsed by Cencori. Spend is capped per call and per day.