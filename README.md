# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar dashboard built for the [token-radar-01](https://make.fun/bounty/token-radar-01) competition on make.fun.

## How to run

```bash
npm install
node main.ts
```

Outputs `out/board.json`, `out/dossier.json`, and `out/data.js` (dashboard).

## Stack

- **main.ts** — entrypoint + pipeline
- **lib/model.ts** — radar scoring model
- **dashboard/** — dashboard assets
- **out/** — generated outputs + screenshots

## License

MIT — see [LICENSE](LICENSE).
