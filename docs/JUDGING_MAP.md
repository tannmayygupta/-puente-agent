# Judging map: criteria -> implementation -> evidence

Legend: **M** = verified on Celo mainnet (see PROOF.md) · **S** = verified by the simulated end-to-end tests (`npm test`) · **C** = implemented in code.

## Stable Agents: LatAm (Ripio)
| Criterion | Where | Status |
|---|---|---|
| Works on mainnet with a real wFIAT token | `src/payout.ts` (transfer of wARS/wBRL/wCOP), `src/config.ts` (token addresses) | C, S (test "happy path"); mainnet payout not yet observed |
| Real use of wFIAT and the Celo stack | wFIAT payout, x402 payments, ERC-8004 identity (#10055), gas handling, tag | M (identity, x402, tag), C/S (wFIAT payout) |
| Agent autonomy and usefulness | payout worker pays only after observing the onchain payment, refunds on failure, no human in the loop (`src/payout.ts`) | S |
| A real person can use the UX | `public/index.html`, `web/main.ts`: wallet connect, gasless x402 signing, ES/PT/EN, Ripio off-ramp link in the receipt | M (page live), C |
| Clear LatAm impact | README "The problem": agent-to-human payout in local currency, no account | n/a |

## Open Corridors: Textile FX
| Criterion | Where | Status |
|---|---|---|
| Quoting and settling on Textile | `src/textile.ts`: keyless firm RFQ with signed proof-of-control, tagged swap, allowance handling, dry-run before broadcast | **M** (swap tx in PROOF.md) |
| Strategy / treasury | `src/treasury.ts`: float targets, rate guard vs 30-minute best, batched refills, exposure cap, consolidation, P&L ledger, public `/agent/log` and `/stats` | S (tests for guard, cap, consolidation, P&L); disabled in the live deployment |
| Volume quoted and filled | `/stats` counts previews and firm quotes | M (1 swap), C |
| Originality | payout funded by the order's own payment (zero-capital), rate-guarded refills | n/a |

## Open Corridors: USA₮ with x402
| Criterion | Where | Status |
|---|---|---|
| Settlement through Celo's x402 facilitator | `src/server.ts` (`paymentMiddleware`, dynamic per-order price, USA₮/USD₮/USDC) | **M** (self-test settlement tx), S (402 challenge test) |
| Real settlement between independent parties | open API: any x402 client can create and pay an order | C; independent payment not yet observed |
| Currency choice justified by the user | USA₮ accepted as the primary token for US-eligible payers; USD₮/USDC also accepted so more payers can use it | n/a |

## Build with buy
| Criterion | Where | Status |
|---|---|---|
| Verified paid calls into services we don't control | `src/buy.ts`: x402 client from the tagged wallet to the buy gateway (Chainstack Celo RPC, Cencori) | **M** (3 calls, settlement hashes in buy-proof.md) |
| Depth of integration | every payout runs a paid batched RPC pre/post check; natural-language parsing via Cencori with a deterministic fallback; budget cap per day | S (accounting and cap tests), C |
| Problem solved | agent-to-human local-currency payout | n/a |
