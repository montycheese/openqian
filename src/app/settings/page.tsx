import { ActionForm } from "@/components/action-form";
import { CurrencySelect, Field, Select } from "@/components/fields";
import { deleteCategory, saveCategory, setBaseCurrency } from "@/lib/actions";
import { clearManualRateAction, refreshFxAction, saveManualRate } from "@/lib/fx/actions";
import type { RateInfo } from "@/lib/fx";
import { getBaseCurrency, getFxRates, listCategories } from "@/lib/queries";

const kindOptions = [
  { value: "asset", label: "Asset" },
  { value: "debt", label: "Debt" },
];

export default async function SettingsPage() {
  const [baseCurrency, categories, rates] = await Promise.all([getBaseCurrency(), listCategories(), getFxRates()]);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="card p-5">
        <h2 className="font-medium">Base currency</h2>
        <p className="mt-1 text-sm text-muted">Totals are shown in this currency.</p>
        <ActionForm action={setBaseCurrency} submitLabel="Save" successMessage="Saved" className="mt-4 space-y-4">
          <CurrencySelect name="baseCurrency" label="Currency" defaultValue={baseCurrency} />
        </ActionForm>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="font-medium">Exchange rates</h2>
            <p className="mt-1 text-sm text-muted">Central bank reference rates via Frankfurter. A manual rate overrides it.</p>
          </div>
          <ActionForm action={refreshFxAction} submitLabel="Refresh rates" submitClassName="btn" successMessage="Rates updated" className="space-y-2" />
        </div>
        {rates.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">Everything is in {baseCurrency}, so no rates are needed.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rates.map((r) => (
              <RateRow key={r.currency} info={r} base={baseCurrency} />
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-border px-4 py-3 font-medium">Categories</h2>
        <ul className="divide-y divide-border">
          {categories.map((c) => (
            <li key={c.id}>
              <details>
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 hover:bg-background">
                  <span>{c.name}</span>
                  <span className="text-xs text-muted">{c.kind === "debt" ? "Debt" : "Asset"}</span>
                </summary>
                <div className="space-y-3 border-t border-border bg-background px-4 py-4">
                  <ActionForm action={saveCategory} submitLabel="Save" successMessage="Saved">
                    <input type="hidden" name="id" value={c.id} />
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Name" name="name" defaultValue={c.name} required />
                      <Select label="Type" name="kind" defaultValue={c.kind} options={kindOptions} />
                      <Field label="Order" name="sortOrder" type="number" defaultValue={c.sortOrder} />
                    </div>
                  </ActionForm>
                  <ActionForm action={deleteCategory} submitLabel="Delete category" submitClassName="btn-danger">
                    <input type="hidden" name="id" value={c.id} />
                  </ActionForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
        <details className="border-t border-border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-accent">+ Add category</summary>
          <div className="px-4 pb-4">
            <ActionForm action={saveCategory} submitLabel="Add category" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Name" name="name" required />
                <Select label="Type" name="kind" options={kindOptions} />
                <Field label="Order" name="sortOrder" type="number" defaultValue={categories.length} />
              </div>
            </ActionForm>
          </div>
        </details>
      </section>
    </div>
  );
}

const formatRate = (n: number) => new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(n);

function RateRow({ info, base }: { info: RateInfo; base: string }) {
  const { currency, rate, source, date, via, manualPair } = info;
  return (
    <li>
      <details>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 hover:bg-background">
          {rate === null ? (
            <span>
              {currency} <span className="text-sm text-negative">No rate — excluded from totals</span>
            </span>
          ) : (
            <span className="num">
              1 {currency} = {formatRate(rate)} {base}
            </span>
          )}
          {rate !== null && (
            <span className="text-xs text-muted">
              {source === "manual" ? "Manual" : "Frankfurter"} · {date}
              {via && ` · via ${via}`}
            </span>
          )}
        </summary>
        <div className="space-y-3 border-t border-border bg-background px-4 py-4">
          <ActionForm action={saveManualRate} submitLabel="Set manual rate" successMessage="Saved">
            <input type="hidden" name="currency" value={currency} />
            <Field
              label={`1 ${currency} in ${base}`}
              name="rate"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              required
              defaultValue={manualPair && rate !== null ? Number(rate.toPrecision(6)) : undefined}
            />
          </ActionForm>
          {manualPair && (
            <ActionForm action={clearManualRateAction} submitLabel="Clear manual rate" submitClassName="btn">
              <input type="hidden" name="base" value={manualPair.base} />
              <input type="hidden" name="quote" value={manualPair.quote} />
            </ActionForm>
          )}
        </div>
      </details>
    </li>
  );
}
