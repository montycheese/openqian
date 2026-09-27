import { ActionForm } from "@/components/action-form";
import { CurrencySelect, Field, InstitutionField, Select } from "@/components/fields";
import { createAccount } from "@/lib/actions";
import { getBaseCurrency, listCategories } from "@/lib/queries";

export default async function NewAccountPage() {
  const [categories, baseCurrency] = await Promise.all([listCategories(), getBaseCurrency()]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Add account</h1>
      <div className="card p-5">
        <ActionForm action={createAccount} submitLabel="Create account">
          <Field label="Name" name="name" required placeholder="e.g. Brokerage, House, Startup shares" />
          <InstitutionField />
          <Select
            label="Category"
            name="categoryId"
            options={categories.map((c) => ({ value: c.id, label: `${c.name}${c.kind === "debt" ? " (debt)" : ""}` }))}
          />
          <fieldset>
            <legend className="label">How is it valued?</legend>
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2">
                <input type="radio" name="kind" value="value" defaultChecked className="mt-1 accent-accent" />
                <span>
                  A single value I update over time
                  <span className="block text-muted">Bank balances, real estate, private shares, loans</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="kind" value="holdings" className="mt-1 accent-accent" />
                <span>
                  A list of holdings
                  <span className="block text-muted">Tickers and quantities, e.g. a brokerage account</span>
                </span>
              </label>
            </div>
          </fieldset>
          <CurrencySelect defaultValue={baseCurrency} />
          <Field
            label="Current value"
            name="initialValue"
            type="number"
            step="any"
            inputMode="decimal"
            hint="Optional, for single-value accounts. Enter debts as positive amounts."
          />
        </ActionForm>
      </div>
    </div>
  );
}
