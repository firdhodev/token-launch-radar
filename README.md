# Token Launch Radar

A make.fun `token-radar-01` competition entry: a radar that ranks every pre-token protocol by the value its future token may take, from the snapshot's own figures, and hands the reader a costed farm plan for each.

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/firdhodev/token-launch-radar/rank.svg)](https://make.fun/competitions/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/firdhodev/token-launch-radar/reward.svg)](https://make.fun/competitions/token-radar-01)

## What it does

`main.ts` (Node 22, standard library only) reads the sealed snapshot (`input/snapshot.json`), scores every protocol, and writes a ranked board (`board.json`), a dashboard (`dashboard/` + `data.js`), screenshots, and the judge's `dossier.json`.

## The value model

```
implied = round(TVL x category-median live mcap/TVL x growthScore x ageScore x sizeScore)
```

- **base** — `TVL x multiple`, where the multiple is the median `mcap/tvl` of the snapshot's live-token protocols in the same category (global fallback).
- **growthScore** — bounded 0.85–1.35 from the 7-day change (`change_7d`), so one wild week can't dominate.
- **ageScore** — bounded 0.70–1.30 over 1,095 days since `listed_at` with no token (the longer it has run tokenless, the more track record a launch rests on).
- **sizeScore** — bounded 0.90–1.10 on a logarithmic TVL adjustment.

The board keeps protocols whose token already trades (has market cap / CoinGecko id / symbol) apart from those still to come; only pre-token protocols are ranked.

## Farm plans

Every row carries concrete steps with a dollar cost (gas differs by chain) and a time, sized from the protocol's TVL and differentiated by category (DEX, LST, restaking, lending, bridge, oracle, RWA).

## Run

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

Then open `out/dashboard/index.html` (it reads `data.js` beside it, fully offline).

## License

MIT
