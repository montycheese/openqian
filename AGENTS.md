<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OpenQian — guide for AI agents

OpenQian is a **local-only, view-only** net worth and portfolio tracker. It runs on the user's own machine (`127.0.0.1`), stores everything in one SQLite file, never moves money, and must stay **free to run** (no paid APIs, no aggregators by default). Read `README.md` for the user-facing picture and `PLAN.md` for scope and design decisions.

If you are here to **help a user install and set up OpenQian** (not to change code), skip to [Helping a user set up OpenQian](#helping-a-user-set-up-openqian).

## Commands

Always use Node 24 (`nvm use` reads `.nvmrc`) and pnpm (`corepack enable pnpm`).

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server on http://127.0.0.1:3000. Next.js allows **one dev server per project folder** — don't start a second one or kill the user's; use a `git worktree` outside the repo for a separate server. |
| `pnpm verify` | Typecheck, lint, all tests, production build, and `scripts/smoke.mjs` (loads every page against a seeded throwaway DB). **Run it before every commit and gate the commit on its exit code**, not on grepping its output. |
| `pnpm test` | Vitest unit + integration tests (no network). |
| `pnpm db:generate` | Create a migration after editing `src/lib/db/schema.ts`. |
| `pnpm demo` | After `pnpm build`: runs the app with a sample portfolio in a throwaway DB. Use it for screenshots (`docs/`) and UI review. |

## Architecture map

```
src/app/                 Pages (App Router). Server Components read the DB directly via src/lib/queries.ts.
src/components/          Shared UI. action-form.tsx wraps Server Actions; sensitive.tsx masks numbers.
src/lib/db/              Drizzle schema + connection. Migrations in drizzle/ run automatically.
src/lib/actions.ts       Server Actions for accounts, valuations, holdings, settings, categories.
src/lib/valuation.ts     Pure net worth math (summarizeNetWorth). Heavily tested; keep it pure.
src/lib/snapshots.ts     Daily snapshots (recordSnapshot after anything that changes values).
src/lib/history.ts, chart.ts   History queries and chart helpers.
src/lib/import/          File importers: parse-holdings.ts (CSV/XLSX, header detection), ofx.ts (OFX/QFX).
src/lib/prices/          Yahoo Finance + CoinGecko quotes for manual/imported holdings.
src/lib/fx/              Frankfurter exchange rates, conversion, manual overrides.
src/lib/connections/     Crypto exchanges via ccxt (read-only keys, encrypted).
src/lib/wallets/         Watch-only blockchain wallets. chains/ holds one ChainAdapter per chain;
                         EVM networks are config entries in chains/evm.ts.
src/lib/secrets.ts       AES-256-GCM secret storage; master key in the OS keychain.
scripts/smoke.mjs        Page smoke test used by pnpm verify.
```

## Conventions

- **Money:** every amount carries its own currency code; convert with the converter from `src/lib/fx` (`loadConverter`). Debts are stored as positive amounts in debt categories.
- **Dates:** use `localDate()` from `src/lib/dates.ts` for "today" (the user's calendar), never `toISOString().slice(0, 10)`.
- **Mutations:** Server Actions in `"use server"` files return `ActionState` (`{ error?, ok?, message? }`); validate input with zod; call `recordSnapshot()` after changing values, then `revalidatePath("/", "layout")`. Forms use `<ActionForm>` (it submits via `onSubmit` so React doesn't wipe input on validation errors).
- **Theme (Jade Treasury):** light only; colours are CSS variables in `globals.css` (`--lacquer`, `--gold`, `--ink`, `--jade`, …). Use the utilities `card` (paper panel), `lacquer` (red panel with gold trim, gold-light text), `paper` (row inside a lacquer panel), `brush` (brush font for Chinese labels), `btn`/`btn-primary`/`btn-danger`, `input`. Shared pieces live in `src/components/treasury.tsx` (coin emblem, ingot, seal, milestone coins, share-graded tiles); grades, milestones, and category Chinese labels in `src/lib/treasury.ts`. Keep wording plain — the flavour is visual. Fonts are system fonts; don't add web font downloads.
- **Private mode:** wrap every displayed amount, quantity, price, or change in `<Sensitive>` (`src/components/sensitive.tsx`); client charts use `usePrivateMode()`.
- **Schema changes:** edit `schema.ts`, run `pnpm db:generate`, commit the migration. Never edit a migration that has been committed.
- **Adding a chain:** implement `ChainAdapter` (`src/lib/wallets/types.ts`) or add an EVM config via `createEvmChain`, register it in `chains/index.ts`, verify token contracts on-chain, and use only free public endpoints.
- **Adding an importer format:** prefer extending the generic header matchers in `parse-holdings.ts`; add a synthetic fixture test (never real user files).
- **Tests:** in-memory DB via `openDatabase(":memory:")` and `vi.mock("@/lib/db", …)`; mock `next/cache`; inject `fetch` — tests must not hit the network. Add new pages/routes to `scripts/smoke.mjs`.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `build:`; optional scope, e.g. `feat(wallets): …`.

## Gotchas we've hit

- `tsconfig` targets ES2017: no BigInt literals (`0n`) — use `BigInt(0)`.
- Don't import constants from a `"use client"` module into a Server Component; you get a client reference, not the value. Shared constants go in `src/lib/`.
- The dev server caches the DB connection across hot reloads; `getDb()` re-applies new migrations in development.
- Server-rendered values that differ between Node and the browser (e.g. `Intl.supportedValuesOf`) cause hydration errors — compute them on the server only.
- CoinGecko's free API rate-limits aggressively (one contract lookup per request); batch by id, fall back to Coinbase public tickers, and keep last known prices rather than writing $0.
- Public RPC endpoints differ in batch limits; the EVM adapter uses a single Multicall3 call.

## Safety rules

- The app is view-only: never add code that places orders, transfers, or signs transactions. Exchange keys must be read-only (Coinbase keys with trade/transfer permission are refused).
- Never commit real financial data: `.db`, `.csv`, `.xlsx`, `.ofx`, `.qfx` are gitignored except under `fixtures/`. Use synthetic data in tests.
- Never print, log, or send secrets; they're encrypted at rest and only decrypted to call the provider.
- Keep the server bound to `127.0.0.1`.

## Helping a user set up OpenQian

Walk the user through these steps, running commands for them where you can and explaining what each does. Don't ask for or handle their bank passwords, API secrets, or account numbers — they enter those in the app themselves.

1. **Prerequisites.** Check `node -v`. If it isn't 24+, install Node 24 (nvm: `nvm install 24 && nvm use 24`; or the installer from nodejs.org). Then `corepack enable pnpm`.
2. **Install and build.** In the repo: `pnpm install`, then `pnpm build`. Optionally run `pnpm verify` to confirm everything works on their machine.
3. **Start it.** `pnpm start` and open http://127.0.0.1:3000. (Use `pnpm dev` only if they want to change code.) Their data lives in the per-user folder listed in the README; nothing is uploaded anywhere.
4. **First run, in the app** (guide them; they click through it):
   - *Settings*: pick a base currency.
   - *Add*: create accounts for things without files or APIs (house, car, private shares, loans).
   - *Import*: for each bank/brokerage, tell them where to download a positions (CSV/XLSX) or Quicken (QFX/OFX) file — see the README table — and have them drop it on the Import page.
   - *Connections*: exchanges need a **read-only** API key they create themselves; wallets need only a public address.
   - *Dashboard → Refresh all* to load prices, rates, and balances.
5. **Keep it running / updating.** Show them how to back up (copy the `.db` file while stopped) and update (`git pull && pnpm install && pnpm build`, then restart).
6. **If something fails**, run `pnpm verify` and read the first failing step; the README has a troubleshooting section.
