import { ActionForm } from "@/components/action-form";
import { CurrencySelect, Field, Select } from "@/components/fields";
import { deleteCategory, saveCategory, setBaseCurrency } from "@/lib/actions";
import { getBaseCurrency, listCategories } from "@/lib/queries";

const kindOptions = [
  { value: "asset", label: "Asset" },
  { value: "debt", label: "Debt" },
];

export default async function SettingsPage() {
  const [baseCurrency, categories] = await Promise.all([getBaseCurrency(), listCategories()]);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="card p-5">
        <h2 className="font-medium">Base currency</h2>
        <p className="mt-1 text-sm text-muted">Totals and charts are shown in this currency.</p>
        <ActionForm action={setBaseCurrency} submitLabel="Save" successMessage="Saved" className="mt-4 space-y-4">
          <CurrencySelect name="baseCurrency" label="Currency" defaultValue={baseCurrency} />
        </ActionForm>
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
            <ActionForm action={saveCategory} submitLabel="Add category">
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
