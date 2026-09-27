import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { getBaseCurrency, listCategories } from "@/lib/queries";
import { ImportFlow } from "./import-flow";

export default async function ImportPage() {
  await connection();
  const [categories, currency] = await Promise.all([listCategories(), getBaseCurrency()]);
  const visible = getDb().select().from(accounts).where(eq(accounts.isHidden, false)).all();
  const option = (a: (typeof visible)[number]) => ({
    value: a.id,
    label: [a.name, a.institution && `(${a.institution})`].filter(Boolean).join(" "),
  });
  const byName = (name: string, kind: "asset" | "debt") =>
    (categories.find((c) => c.name === name && c.kind === kind) ?? categories.find((c) => c.kind === kind))?.id ?? "";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Import</h1>
        <p className="mt-1 text-sm text-muted">
          Add a positions export from your brokerage (.csv / .xlsx / .ofx) or a bank or credit card download (.qfx /
          .ofx, often labeled &quot;Quicken&quot;). Files are read on this computer and aren&apos;t kept.
        </p>
      </div>
      <ImportFlow
        holdingsAccounts={visible.filter((a) => a.kind === "holdings").map(option)}
        valueAccounts={visible.filter((a) => a.kind === "value").map(option)}
        assetCategories={categories.filter((c) => c.kind === "asset").map((c) => ({ value: c.id, label: c.name }))}
        allCategories={categories.map((c) => ({ value: c.id, label: `${c.name}${c.kind === "debt" ? " (debt)" : ""}` }))}
        defaults={{ investments: byName("Investments", "asset"), cash: byName("Cash", "asset"), credit: byName("Credit Cards", "debt") }}
        currency={currency}
      />
    </div>
  );
}
