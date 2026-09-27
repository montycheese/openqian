import { and, eq } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { getBaseCurrency, listCategories } from "@/lib/queries";
import { ImportFlow } from "./import-flow";

export default async function ImportPage() {
  await connection();
  const [categories, currency] = await Promise.all([listCategories(), getBaseCurrency()]);
  const holdingsAccounts = getDb()
    .select({ id: accounts.id, name: accounts.name, institution: accounts.institution })
    .from(accounts)
    .where(and(eq(accounts.kind, "holdings"), eq(accounts.isHidden, false)))
    .all();
  const assetCategories = categories.filter((c) => c.kind === "asset");
  const investments = assetCategories.find((c) => c.name === "Investments") ?? assetCategories[0];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Import positions</h1>
        <p className="mt-1 text-sm text-muted">
          Download a positions or holdings export from your brokerage and add it here. The file is read on this computer
          and isn&apos;t kept after import.
        </p>
      </div>
      <ImportFlow
        holdingsAccounts={holdingsAccounts.map((a) => ({
          value: a.id,
          label: [a.name, a.institution && `(${a.institution})`].filter(Boolean).join(" "),
        }))}
        categories={assetCategories.map((c) => ({ value: c.id, label: c.name }))}
        defaultCategoryId={investments?.id ?? ""}
        currency={currency}
      />
    </div>
  );
}
