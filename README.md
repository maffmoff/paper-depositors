# paper-depositors

Papertrade depositors leaderboard. Deposits are read from the Exchange contract
`0x6cd5661646289fb6e65ea5c032310fded797d0a2` on HyperEVM (chain 999); a GitHub Action
re-indexes and publishes `site/` to GitHub Pages; the Cloudflare Worker in `cron/` starts it every 10 minutes.
