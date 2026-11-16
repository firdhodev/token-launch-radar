# Token Radar 01

A static launch radar that ranks every pre-token watchlist protocol and adds early protocols below the TVL floor. The implied value model uses only the sealed snapshot: TVL, clamped seven-day growth, and days since listing. The local dashboard includes sortable rankings, category, chain, and cohort filters, search, and a per-protocol valuation breakdown and interaction plan.

Build with Node 22 using `MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json`. The generated `out/` contains the board, browser data, static dashboard, screenshots, and dossier.
