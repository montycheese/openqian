# OpenChieng — Plan

OpenChieng is a self-hosted, view-only net worth and portfolio tracker (in the spirit of Kubera) that runs entirely on your own machine. Intended to be open-sourced so anyone can run it with their own provider credentials.

## Principles

- **Local-only.** Server binds to `127.0.0.1`. No deployment, no cloud backend, no telemetry.
- **View-only.** Never moves money. All provider credentials use read-only scopes/keys.
- **Manual refresh.** Data updates when the user clicks refresh (per connection or "Refresh all"). No background jobs.
- **Provider-agnostic.** Every data source implements one adapter interface; users enable only the providers they have credentials for.
- **Bring your own credentials.** Nothing is shipped in the repo; credentials are entered in a settings UI and encrypted at rest.
- **Multi-currency native.** Every amount carries a currency code.
- **No cost, no middlemen by default.** The core works without paid services or third-party aggregators. Data comes from files you download, official free APIs you hold keys to, or manual entry. Paid/aggregator adapters may exist as optional extras.

## Scope

### In scope (MVP)

1. **Net worth dashboard** — total assets, total debts, net worth, change since last snapshot.
2. **Assets & debts sheets** — grouped by user-editable categories (Cash, Investments, Retirement, Crypto, Private Equity, Real Estate, Debts, …) with account → holdings drill-down.
3. **Sources manager** — per account: source (import / API / manual), last updated, status, and a staleness indicator (e.g. "updated 34 days ago") so file-based accounts get a nudge. "Refresh all" for API sources and prices.
4. **File import (OFX/QFX + CSV)** — drag-and-drop a bank or brokerage export; auto-detect format; preview changes; map to an existing account (matched by account number / last 4) or create one; confirm. Balances from bank files, positions from brokerage files.
5. **Manual assets**
   - *Market-priced:* ticker + quantity, price fetched automatically.
   - *Custom-valued:* private shares, real estate, vehicles, collectibles, private loans, etc. Value entered directly or as quantity × price-per-share, with dated valuation history and notes.
6. **Multi-currency** — base currency setting (default USD), native + converted display, FX rates, historical rates stored with snapshots.
7. **Snapshots** — each refresh records net worth + per-account values, powering history.
8. **History charts** — net worth over time, per-account history.

### v2

- Private equity details: vesting schedules, option strike price, optional liquidity discount
- Asset allocation views (by class, account, currency, liquid vs. illiquid)
- Cost basis / unrealized gain where the source provides it
- Tags, hidden accounts, exclude-from-net-worth
- Encrypted backup / export (JSON, CSV)

### Out of scope (for now)

- Transactions, budgeting, spending analysis
- On-chain wallet tracking (adapter interface should leave room for it later)
- Bill pay, money movement, sharing / beneficiary features, mobile app
- Any hosted / multi-user deployment

## Data sources

### Core (free, no aggregator)

| Source | Covers | Credentials | Notes |
|---|---|---|---|
| **OFX/QFX import** | Bank balances (`LEDGERBAL`), brokerage positions (`INVPOSLIST`) | None — user downloads file | One generic parser covers many institutions ("Quicken / Web Connect" downloads). |
| **CSV / Excel import** | Brokerage positions, bank balances | None — user downloads file | `.csv`, `.xls`, `.xlsx`. Per-institution format profiles (Fidelity, Schwab, Robinhood, Morgan Stanley, Chase, Wells Fargo to start); easy community contributions. |
| **Manual** | Anything | — | Market-priced (ticker + qty) or custom-valued. |
| **Schwab Trader API** | Schwab positions and balances | User's own Schwab developer app (free) | Official, direct, no middleman. Requires app approval; refresh token expires ~every 7 days → re-login flow. Needs an HTTPS callback (`https://127.0.0.1` via mkcert). |
| **CCXT** | Crypto exchange balances | Read-only exchange API keys | Warn if a key appears to have trade/withdraw permissions. |
| **Price feeds** | Quotes for tickers (manual and imported) and crypto | None by default | Pluggable; default `yahoo-finance2`, crypto via CoinGecko free tier. |
| **FX rates** | Currency conversion | None (Frankfurter / ECB) | Manual override for unsupported currencies. |

### Optional adapters (not on the core roadmap)

Third-party aggregators that some users may want: **SimpleFIN Bridge** (~$15/yr, balances), **SnapTrade** (free personal tier, holdings via their portal), **Plaid** (user's own production keys). The adapter interface keeps these possible as community contributions.

### Adapter interface (sketch)

```ts
interface ProviderAdapter {
  id: string;                                  // "schwab" | "ccxt" | ... (file import uses a separate Importer interface)
  connect(input: unknown): Promise<ConnectionSecrets>;
  refresh(secrets: ConnectionSecrets): Promise<{
    accounts: NormalizedAccount[];             // id, name, type, currency, balance, balanceAsOf
    holdings: NormalizedHolding[];             // accountId, symbol, name, quantity, price, value, currency, costBasis?
  }>;
  disconnect?(secrets: ConnectionSecrets): Promise<void>;
}
```

Errors are normalized into states the UI understands: `ok`, `stale`, `reauth_required`, `error`.

### Importer interface (sketch)

```ts
interface Importer {
  id: string;                                  // "ofx" | "csv:fidelity-positions" | "csv:chase-activity" | ...
  detect(file: { name: string; text: string }): boolean;
  parse(file: { name: string; text: string }): {
    accounts: NormalizedAccount[];             // with accountNumberMask for matching
    holdings: NormalizedHolding[];
    asOf: Date;                                // statement / export date
  };
}
```

Imports are recorded (`imports` table: file name, importer, asOf, account, result) but raw files are not stored.

General importer rules:
- Locate the header row by its column names, not a fixed row number; skip preamble and disclaimer rows.
- One file may contain **multiple accounts**; group rows by account.
- Treat `-` / `N/A` / blank as null.
- Skip total rows, but use them as a **checksum** (sum of row values must match the file total; a mismatch is shown as a warning before import).
- Positions without a usable ticker (cash sweeps, bonds, CDs, structured products) keep the file's market value and are not repriced.
- Capture cost basis and CUSIP when present.
- Test fixtures are synthetic (fake accounts and numbers in the real layout); real exports are never committed.

### Morgan Stanley "Holdings Ungrouped" (.xlsx) format

- Single sheet `Holdings`. Row 5: `Holdings for Institution Morgan Stanley as of MM/DD/YYYY hh:mm AM ET` → `asOf`.
- Header row starts with `Account Number`; data rows until a row whose first cell is `Total`.
- `Account Number` looks like `<nickname> - <last4>` → account name + mask for matching.
- Useful columns: `Name`, `Product Type`, `Symbol`, `CUSIP`, `Last ($)`, `As of`, `Quantity`, `Market Value ($)`, `Total Cost ($)`, `Adjusted Cost ($)`.
- Cash sweep rows have `Product Type` = `Cash, MMF and BDP`, a non-ticker symbol, and no price/quantity → import as cash by market value.

## Multi-currency design

- Every account, holding, valuation, and price stores its **native currency**.
- **Base currency** is a user setting (default USD); totals, charts, and allocation are shown in base currency.
- FX rates are fetched on refresh and cached locally; users can override rates manually.
- **Snapshots persist the FX rates used**, so historical net worth never silently changes, and FX-driven vs. asset-driven changes can be separated later.
- Foreign-currency rows show both values, e.g. `€12,000 (≈ $13,020)`.
- Crypto is modeled as a holding priced in fiat, not as a currency.

## Security

- Bind to `127.0.0.1` only.
- Provider secrets (tokens, API keys) encrypted at rest; the master key is stored in the OS keychain.
- Optional unlock passcode on app start.
- Database file kept outside cloud-synced folders by default.
- No secrets in the repo; provide `.env.example` for non-secret config only.

## Tech stack

- **Next.js (App Router) + TypeScript**, run locally (`npm run dev` / `npm start`)
- **SQLite** via **Drizzle ORM** (single file, easy backup)
- `ccxt`, `yahoo-finance2`, an OFX parser, `papaparse` for CSV
- **Recharts** for charts
- UI: Tailwind (plain components for now; design to be refined later)

## Data model (sketch)

- `settings` — base currency, preferences
- `secrets` — encrypted provider credentials
- `connections` — API provider (Schwab, exchanges), label, status, last refreshed, last error
- `imports` — file name, importer id, as-of date, target account, result
- `accounts` — source (import / connection / manual), account number mask, name, type, category, currency, current balance, hidden / excluded flags
- `holdings` — account, security, quantity, price, value, currency, cost basis
- `securities` — symbol, name, type, currency *(deferred: holdings carry symbol/CUSIP directly for now)*
- `manual_valuations` — account/asset, date, value or qty × price, currency, note
- `categories` — user-editable grouping, asset vs. debt
- `prices` — security, date, price, currency, source
- `fx_rates` — date, base, quote, rate, source
- `snapshots` — timestamp, net worth, assets, debts, base currency, FX rates used
- `snapshot_accounts` — snapshot, account, native value, base value

## Build order

1. ✅ **Foundation** — scaffold, schema (currency on every amount), encrypted secret storage, manual assets, dashboard, institution picker.
2. ✅ **File import** *(pulled forward)* — generic positions parser for CSV/XLSX (header detection, multi-account files, cash detection, total-row checksum), preview + account matching by account number. Verified on a real Morgan Stanley export; Fidelity/Schwab layouts covered by synthetic tests and still need real sample files.
3. ✅ **Crypto exchanges** *(pulled forward)* — ccxt connections (Coinbase, Kraken, Gemini, Binance.US) with encrypted keys, Coinbase key-permission check (refuses trade/transfer keys), balances priced in USD from the exchange's own markets, per-connection and "refresh all".
4. **Prices & FX** — price feeds for manual tickers, FX fetch/cache, base-currency conversion, dual display.
5. **Snapshots & history charts.**
6. **Schwab Trader API adapter.**
7. **OFX/QFX import** for bank balances (Chase, Wells Fargo).
8. v2 features; optional aggregator adapters as community contributions.

## Open-source readiness

- Permissive license, README with per-institution export guides and per-provider setup guides
- No credentials in repo; setup happens through the UI
- Each provider isolated in its own module under a shared adapter interface
- Works with any subset of providers enabled (including none — manual only)

## Decisions

| Topic | Decision |
|---|---|
| Name | **OpenChieng** |
| License | MIT |
| Package manager | pnpm |
| Master key storage | OS keychain via a cross-platform library (`@napi-rs/keyring`); fall back to a startup passphrase when no keychain is available |
| Data location | Per-user app-data dir (e.g. `~/Library/Application Support/OpenChieng` on macOS), overridable with `DATA_DIR` |
| Snapshot granularity | One per day; the latest refresh of the day replaces earlier ones |
| Duplicate accounts across providers | Accounts can be linked; the user picks which source counts toward net worth (minimum: hide one) |
| Cost | Core must be free to run; no paid services required |
| Third-party aggregators | Not used by default (they hold users' credentials and data; possible as optional adapters) |
| Stock price source | Pluggable; default `yahoo-finance2` (no key), Finnhub / Alpha Vantage as alternatives |

## Open questions

- Which export formats each institution actually offers today (positions CSV vs. OFX/QFX, and whether exports include balances). Verify with real sample files in step 3 — samples should be redacted and never committed.
- Robinhood: does it offer a positions export, or only statements / activity? May fall back to manual positions.
- Schwab Trader API: confirm individual app approval turnaround and callback URL requirements in step 5.
