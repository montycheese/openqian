import Link from "next/link";
import { walletChains } from "@/lib/wallets";
import { refreshWalletAction } from "@/lib/wallets/actions";
import { chainById } from "@/lib/wallets/chains";
import { NetworkBadge } from "@/components/network-badge";
import { notFound } from "next/navigation";
import { localDate } from "@/lib/dates";
import { ActionForm } from "@/components/action-form";
import { Checkbox, CurrencySelect, Field, InstitutionField, Select } from "@/components/fields";
import { Amount } from "@/components/money";
import {
  addValuation,
  deleteAccount,
  deleteHolding,
  deleteValuation,
  saveHolding,
  updateAccount,
} from "@/lib/actions";
import { refreshConnection } from "@/lib/connections/actions";
import { EXCHANGE_LABELS } from "@/lib/connections/exchange";
import { holdingTypes, type Account, type Category, type Holding, type Valuation } from "@/lib/db/schema";
import { HistoryCard } from "@/components/history-card";
import { parseRange, pointsSince, rangeHref, valuationSeries, type ChartPoint } from "@/lib/chart";
import { rangeStart, type HistoryRange } from "@/lib/history";
import { formatMoney, formatNumber } from "@/lib/money";
import { Sensitive } from "@/components/sensitive";
import { getAccountDetail, getAccountSeries, getNetWorth, listCategories } from "@/lib/queries";
import { Seal, Tile, type Face } from "@/components/treasury";
import { CATEGORY_ZH, gradeFor } from "@/lib/treasury";

export default async function AccountPage({ params, searchParams }: PageProps<"/accounts/[id]">) {
  const { id } = await params;
  const range = parseRange((await searchParams).range);
  const [detail, categories] = await Promise.all([getAccountDetail(id), listCategories()]);
  if (!detail) notFound();
  const { account, category, history, positions, summary, baseCurrency, link, wallet, lastImport } = detail;
  const isDebt = category.kind === "debt";
  const chart = await accountChart(account, history, baseCurrency, range);
  const { assets: totalAssets } = await getNetWorth();

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <div className="space-y-5">
        <Link href="/" className="text-sm no-underline hover:underline">
          ← Dashboard
        </Link>
        <section className="card relative p-5">
          {lastImport && !link && <Seal title="Filled from an imported statement" className="absolute top-3 right-3" />}
          <p className="pr-10 text-sm text-muted">
            {category.name} {CATEGORY_ZH[category.name] && <span className="brush text-lacquer">{CATEGORY_ZH[category.name]}</span>}
            {account.institution && ` · ${account.institution}`}
          </p>
          <h1 className="mt-1 pr-10 text-2xl font-bold">{account.name}</h1>
          <div className="mt-3 text-3xl font-bold">
            <Amount
              base={summary.base}
              baseCurrency={baseCurrency}
              native={summary.native}
              negative={isDebt}
              unconverted={summary.missingRates.length > 0 && summary.base === 0}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            {summary.isEmpty ? "No value yet" : `As of ${summary.asOf}`}
            {account.isExcluded && " · excluded from net worth"}
            {account.isHidden && " · hidden"}
          </p>
          {link && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className={link.status === "ok" ? "text-muted" : "text-negative"}>
                {link.status === "ok"
                  ? `Synced from ${EXCHANGE_LABELS[link.exchange]}${link.lastRefreshedAt ? ` · ${link.lastRefreshedAt.toLocaleString("en-US")}` : ""}`
                  : link.lastError}
              </span>
              <ActionForm action={refreshConnection} submitLabel="Refresh" submitClassName="btn" className="space-y-2">
                <input type="hidden" name="id" value={link.id} />
              </ActionForm>
            </div>
          )}
          {wallet && (
            <div className="mt-3 space-y-2 text-sm">
              <p className="break-all font-mono text-xs text-muted">{wallet.address}</p>
              <p className="flex flex-wrap gap-x-3 gap-y-1">
                {walletChains(wallet).map((id) => {
                  const chain = chainById(id);
                  return chain ? (
                    <a key={id} href={chain.explorerUrl(wallet.address)} target="_blank" rel="noreferrer" className="underline">
                      {chain.label} ↗
                    </a>
                  ) : null;
                })}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <span className={wallet.status === "ok" ? "text-muted" : "text-negative"}>
                  {wallet.status === "ok"
                    ? wallet.lastRefreshedAt
                      ? `Updated ${wallet.lastRefreshedAt.toLocaleString("en-US")}`
                      : "Not loaded yet"
                    : wallet.lastError}
                </span>
                <ActionForm action={refreshWalletAction} submitLabel="Refresh" submitClassName="btn" className="space-y-2">
                  <input type="hidden" name="id" value={wallet.id} />
                </ActionForm>
              </div>
            </div>
          )}
          {lastImport && !link && (
            <p className="mt-3 text-sm text-muted">
              Imported from {lastImport.fileName} (as of {lastImport.asOf}) ·{" "}
              <Link href="/import" className="underline">
                Import a newer file
              </Link>
            </p>
          )}
          {summary.missingRates.length > 0 && (
            <p className="mt-3 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning-fg">
              No exchange rate yet for {summary.missingRates.join(", ")}.
            </p>
          )}
        </section>
        <AccountSettings account={account} categories={categories} />
      </div>

      <div className="min-w-0 space-y-5">
        {chart && (
          <HistoryCard
            title="Value over time"
            currency={chart.currency}
            points={chart.points}
            range={range}
            hrefFor={(r) => rangeHref(`/accounts/${account.id}`, {}, r)}
            step={account.kind === "value"}
            invert={isDebt}
          />
        )}

        {account.kind === "value" ? (
          <ValueSection account={account} history={history} />
        ) : (
          <HoldingsSection account={account} positions={positions} totalAssets={totalAssets} />
        )}
      </div>
    </div>
  );
}

function AccountSettings({ account, categories }: { account: Account; categories: Category[] }) {
  return (
    <>
      <details className="card p-5">
        <summary className="cursor-pointer font-medium">Edit account</summary>
        <div className="mt-4">
          <ActionForm action={updateAccount} submitLabel="Save" successMessage="Saved">
            <input type="hidden" name="id" value={account.id} />
            <Field label="Name" name="name" defaultValue={account.name} required />
            <InstitutionField defaultValue={account.institution ?? ""} />
            <Select
              label="Category"
              name="categoryId"
              defaultValue={account.categoryId}
              options={categories
                .filter((c) => account.kind === "value" || c.kind === "asset")
                .map((c) => ({ value: c.id, label: `${c.name}${c.kind === "debt" ? " (debt)" : ""}` }))}
            />
            <CurrencySelect defaultValue={account.currency} />
            <Field label="Notes" name="notes" defaultValue={account.notes ?? ""} />
            <Checkbox label="Exclude from net worth" name="isExcluded" defaultChecked={account.isExcluded} />
            <Checkbox label="Hide from dashboard" name="isHidden" defaultChecked={account.isHidden} />
          </ActionForm>
        </div>
      </details>

      <details className="card p-5">
        <summary className="cursor-pointer font-medium text-negative">Delete account</summary>
        <div className="mt-4">
          <ActionForm action={deleteAccount} submitLabel="Delete permanently" submitClassName="btn-danger">
            <input type="hidden" name="id" value={account.id} />
            <p className="text-sm text-muted">This removes the account and all of its history.</p>
            <Checkbox label="Yes, delete this account" name="confirm" />
          </ActionForm>
        </div>
      </details>
    </>
  );
}

/**
 * Chart data for an account, or null with under two data points in all history.
 * Value accounts use their dated valuations (native currency); holdings
 * accounts use daily snapshots (base currency).
 */
async function accountChart(
  account: Account,
  valuations: Valuation[],
  baseCurrency: string,
  range: HistoryRange,
): Promise<{ currency: string; points: ChartPoint[] } | null> {
  const start = rangeStart(range);
  if (account.kind === "value") {
    const today = localDate();
    const s = valuationSeries(valuations, { start, today });
    return s.currency && s.observations >= 2 ? { currency: s.currency, points: s.points } : null;
  }
  const all = await getAccountSeries(account.id, baseCurrency);
  return all.length >= 2 ? { currency: baseCurrency, points: pointsSince(all, start) } : null;
}

function ValueSection({ account, history }: { account: Account; history: Valuation[] }) {
  const today = localDate();
  return (
    <>
      <section className="card p-5">
        <h2 className="font-medium">Update value</h2>
        <ActionForm action={addValuation} submitLabel="Add value" successMessage="Value added" resetOnSuccess className="mt-4 space-y-4">
          <input type="hidden" name="accountId" value={account.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" name="date" type="date" defaultValue={today} required />
            <Field label={`Value (${account.currency})`} name="value" type="number" step="any" inputMode="decimal" />
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-muted">Or calculate from quantity × price per unit</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Quantity" name="quantity" type="number" step="any" inputMode="decimal" hint="e.g. number of shares" />
              <Field label="Price per unit" name="unitPrice" type="number" step="any" inputMode="decimal" hint="e.g. last round or 409A price" />
            </div>
          </details>
          <Field label="Note" name="note" placeholder="Optional, e.g. Series B price" />
        </ActionForm>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-border px-4 py-3 font-medium">History</h2>
        {history.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">No values yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 text-sm">
                  <span className="block">{v.date}</span>
                  <span className="block truncate text-xs text-muted">
                    {[
                      v.quantity !== null && v.unitPrice !== null
                        ? <Sensitive>{`${formatNumber(v.quantity)} × ${formatMoney(v.unitPrice, v.currency)}`}</Sensitive>
                        : null,
                      v.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="num">
                    <Sensitive>{formatMoney(v.value, v.currency)}</Sensitive>
                  </span>
                  <form action={deleteValuation}>
                    <input type="hidden" name="id" value={v.id} />
                    <button type="submit" className="text-xs text-muted hover:text-negative" aria-label={`Delete value from ${v.date}`}>
                      Delete
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function HoldingFields({ account, holding }: { account: Account; holding?: Holding }) {
  return (
    <>
      <input type="hidden" name="accountId" value={account.id} />
      {holding && <input type="hidden" name="id" value={holding.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Symbol" name="symbol" defaultValue={holding?.symbol ?? ""} placeholder="e.g. VOO" autoCapitalize="characters" />
        <Field label="Name" name="name" defaultValue={holding?.name ?? ""} placeholder="Optional if symbol is set" />
        <Select
          label="Type"
          name="type"
          defaultValue={holding?.type ?? "stock"}
          options={holdingTypes.map((t) => ({ value: t, label: t.toUpperCase() === "ETF" ? "ETF" : t[0].toUpperCase() + t.slice(1) }))}
        />
        <CurrencySelect defaultValue={holding?.currency ?? account.currency} />
        <Field label="Quantity" name="quantity" type="number" step="any" inputMode="decimal" defaultValue={holding?.quantity ?? ""} />
        <Field label="Price" name="price" type="number" step="any" inputMode="decimal" defaultValue={holding?.price ?? ""} />
        <Field
          label="Market value"
          name="marketValue"
          type="number"
          step="any"
          inputMode="decimal"
          defaultValue={holding && (holding.quantity === null || holding.price === null) ? holding.marketValue : ""}
          hint="Only if there's no quantity/price, e.g. cash"
        />
        <Field label="Cost basis (total)" name="costBasis" type="number" step="any" inputMode="decimal" defaultValue={holding?.costBasis ?? ""} />
      </div>
    </>
  );
}

function holdingFace(type: Holding["type"]): Face {
  return type === "cash" ? "coin" : type === "crypto" ? "jade" : type === "bond" ? "seal" : "paper";
}

function HoldingsSection({ account, positions, totalAssets }: { account: Account; positions: Holding[]; totalAssets: number }) {
  return (
    <section className="lacquer overflow-hidden p-3">
      <div className="flex items-baseline justify-between px-1 pb-2">
        <h2 className="font-bold">Holdings</h2>
        <span className="text-xs text-[#e7c9a0]">
          {positions.length} position{positions.length === 1 ? "" : "s"}
        </span>
      </div>
      {positions.length === 0 && <p className="paper px-3 py-3 text-sm text-muted">No holdings yet.</p>}
      <ul className="space-y-1.5">
        {positions.map((h) => (
          <li key={h.id}>
            <details>
              <summary className="paper flex cursor-pointer list-none items-center gap-3 px-2.5 py-2 hover:bg-[#fffaf0]">
                <Tile label={(h.symbol ?? h.name).slice(0, 5)} face={holdingFace(h.type)} gradeColor={gradeFor(h.marketValue, totalAssets).color} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{h.symbol ?? h.name}</span>
                    {h.network && <NetworkBadge network={h.network} />}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {h.quantity !== null && h.price !== null
                      ? <Sensitive>{`${formatNumber(h.quantity)} × ${formatMoney(h.price, h.currency)}`}</Sensitive>
                      : h.symbol
                        ? h.name
                        : h.type}
                  </span>
                </span>
                <span className="num">
                  <Sensitive>{formatMoney(h.marketValue, h.currency)}</Sensitive>
                </span>
              </summary>
              <div className="paper mt-1 space-y-3 px-4 py-4">
                <ActionForm action={saveHolding} submitLabel="Save holding" successMessage="Saved">
                  <HoldingFields account={account} holding={h} />
                </ActionForm>
                <form action={deleteHolding}>
                  <input type="hidden" name="id" value={h.id} />
                  <button type="submit" className="btn-danger">
                    Remove holding
                  </button>
                </form>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <details className="mt-2">
        <summary className="cursor-pointer px-1 py-2 text-sm font-semibold text-gold-light">+ Add holding</summary>
        <div className="paper px-4 py-4">
          <ActionForm action={saveHolding} submitLabel="Add holding" successMessage="Holding added" resetOnSuccess>
            <HoldingFields account={account} />
          </ActionForm>
        </div>
      </details>
    </section>
  );
}
