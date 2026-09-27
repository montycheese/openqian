import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Checkbox, CurrencySelect, Field, Select } from "@/components/fields";
import { Amount } from "@/components/money";
import {
  addValuation,
  deleteAccount,
  deleteHolding,
  deleteValuation,
  saveHolding,
  updateAccount,
} from "@/lib/actions";
import { holdingTypes, type Account, type Holding, type Valuation } from "@/lib/db/schema";
import { formatMoney, formatNumber } from "@/lib/money";
import { getAccountDetail, listCategories } from "@/lib/queries";

export default async function AccountPage({ params }: PageProps<"/accounts/[id]">) {
  const { id } = await params;
  const [detail, categories] = await Promise.all([getAccountDetail(id), listCategories()]);
  if (!detail) notFound();
  const { account, category, history, positions, summary, baseCurrency } = detail;
  const isDebt = category.kind === "debt";

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <p className="text-sm text-muted">
          {[category.name, account.institution].filter(Boolean).join(" · ")}
        </p>
        <h1 className="mt-1 text-xl font-semibold">{account.name}</h1>
        <div className="mt-3 text-2xl font-semibold">
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
        {summary.missingRates.length > 0 && (
          <p className="mt-3 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning-fg">
            No exchange rate yet for {summary.missingRates.join(", ")}.
          </p>
        )}
      </section>

      {account.kind === "value" ? (
        <ValueSection account={account} history={history} />
      ) : (
        <HoldingsSection account={account} positions={positions} />
      )}

      <details className="card p-5">
        <summary className="cursor-pointer font-medium">Edit account</summary>
        <div className="mt-4">
          <ActionForm action={updateAccount} submitLabel="Save" successMessage="Saved">
            <input type="hidden" name="id" value={account.id} />
            <Field label="Name" name="name" defaultValue={account.name} required />
            <Field label="Institution" name="institution" defaultValue={account.institution ?? ""} />
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
    </div>
  );
}

function ValueSection({ account, history }: { account: Account; history: Valuation[] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <section className="card p-5">
        <h2 className="font-medium">Update value</h2>
        <ActionForm action={addValuation} submitLabel="Add value" className="mt-4 space-y-4">
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
                        ? `${formatNumber(v.quantity)} × ${formatMoney(v.unitPrice, v.currency)}`
                        : null,
                      v.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="num">{formatMoney(v.value, v.currency)}</span>
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

function HoldingsSection({ account, positions }: { account: Account; positions: Holding[] }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="border-b border-border px-4 py-3 font-medium">Holdings</h2>
      {positions.length === 0 && <p className="px-4 py-3 text-sm text-muted">No holdings yet.</p>}
      <ul className="divide-y divide-border">
        {positions.map((h) => (
          <li key={h.id}>
            <details>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-background">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{h.symbol ?? h.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {h.quantity !== null && h.price !== null
                      ? `${formatNumber(h.quantity)} × ${formatMoney(h.price, h.currency)}`
                      : h.symbol
                        ? h.name
                        : h.type}
                  </span>
                </span>
                <span className="num">{formatMoney(h.marketValue, h.currency)}</span>
              </summary>
              <div className="space-y-3 border-t border-border bg-background px-4 py-4">
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
      <details className="border-t border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-accent">+ Add holding</summary>
        <div className="px-4 pb-4">
          <ActionForm action={saveHolding} submitLabel="Add holding">
            <HoldingFields account={account} />
          </ActionForm>
        </div>
      </details>
    </section>
  );
}
