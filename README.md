# OpenChieng

A local, view-only net worth and portfolio tracker. It runs entirely on your own machine, uses no paid services or third-party aggregators, and never moves money.

> Status: early development. See [PLAN.md](PLAN.md) for scope and roadmap.

## Features (so far)

- Net worth dashboard grouped by category (assets and debts)
- Manual accounts:
  - **Single-value** accounts with dated history — bank balances, real estate, loans, private shares (value or quantity × price per share)
  - **Holdings** accounts — positions with symbol, quantity, price, and cost basis
- **Import positions** from brokerage exports (`.csv` / `.xlsx`) — e.g. Morgan Stanley "Holdings", Fidelity and Schwab positions downloads. Files are read locally and not kept.
- **Crypto exchanges** via read-only API keys (Coinbase, Kraken, Gemini, Binance.US), refreshed on demand
- Institution picker with common brokerages, banks, and exchanges
- Multi-currency data model with a configurable base currency (exchange rates coming next)
- Exclude or hide accounts; editable categories

## Requirements

- Node.js 24+ (`nvm use` reads `.nvmrc`)
- pnpm (`corepack enable pnpm`)

## Run it

```sh
pnpm install
pnpm build
pnpm start        # http://127.0.0.1:3000
```

For development: `pnpm dev`.

The server listens on `127.0.0.1` only, so it isn't reachable from other devices.

## Where your data lives

A single SQLite file, `openchieng.db`, in:

| OS | Location |
|---|---|
| macOS | `~/Library/Application Support/OpenChieng` |
| Linux | `$XDG_DATA_HOME/openchieng` (default `~/.local/share/openchieng`) |
| Windows | `%APPDATA%\OpenChieng` |

Set `DATA_DIR` to use a different folder. Back up by copying that file while the app is stopped.

Credentials for future API sources are encrypted with a key kept in your OS keychain. Where no keychain is available, set `OPENCHIENG_PASSPHRASE` to derive the key from a passphrase instead.

## Development

```sh
pnpm test         # unit + integration tests
pnpm typecheck
pnpm lint
pnpm db:generate  # create a migration after editing src/lib/db/schema.ts
```

Migrations are applied automatically on startup.

## License

MIT
