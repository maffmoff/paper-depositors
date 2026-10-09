# paper-depositors

Papertrade depositors leaderboard. Every wallet that funded Papertrade, ranked by USDC deposited,
read from the Exchange contract's logs on HyperEVM (chain 999). No database, no server: a scheduled
GitHub Action re-indexes the chain and publishes `site/` to GitHub Pages.

## Data source

| | |
|---|---|
| Chain | HyperEVM mainnet (chain id 999) |
| RPC | `https://rpc.hyperliquid.xyz/evm` and `https://rpc.hypurrscan.io`, round-robin (`PAPERTRADE_RPCS` overrides) |
| Contract | Papertrade Exchange proxy `0x6cd5661646289fb6e65ea5c032310fded797d0a2` |
| Events | deposit topic `0x02d61879cd72906e0951e3a96096407dd2b1f2cd2d063dae983bb20216cf3025` (user, proxy; amount, 0, block) and withdrawal topic `0x95d1a93901f24eeaa294588802f66fa008f9f3741060c9f79e5dab4709de5e75` (user; amount 18dp, amount 8dp) |
| Start block | 47854413, the first block after the protocol genesis reported by `GET /query/protocol/summary` |
| Amounts | USDC with 8 decimals (HyperCore scale), as emitted |

The Exchange ABI is not published. The topics are PUSH32 constants of the implementation bytecode and
their field layout was verified against live transaction receipts; the names here are descriptive labels.
Display names come from the official leaderboard API and are optional (`--no-names`).

## Run locally

```bash
npm ci
npm run depositors:index          # scans from genesis once (~5 min), then incrementally
npm run depositors:serve          # http://localhost:8790/  (--refresh 300 re-indexes every 5 min)
npm test
```

## Publish

`.github/workflows/depositors.yml` runs every 10 minutes: restore the checkpoint from the Actions cache,
index new blocks, upload `site/` to GitHub Pages. Enable Pages with "Source: GitHub Actions" once.
`site/CNAME` holds the custom domain; point its DNS at GitHub Pages.
