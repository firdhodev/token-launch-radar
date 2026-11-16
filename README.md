# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/firdhodev/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/firdhodev/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar — a dashboard that scores and tracks recent token launches. Built for the [token-radar-01](https://make.fun/bounty/token-radar-01) bounty.

## Run it

```sh
npm install && node main.ts
```

Outputs `out/board.json`, `out/dossier.json`, and `out/data.js` (dashboard). Screenshots in `screenshots/`.

## Stack

- **main.ts** — entrypoint + pipeline
- **lib/model.ts** — radar scoring model
- **dashboard/** — dashboard assets
- **out/** — generated outputs

## License

MIT — see [LICENSE](LICENSE).
