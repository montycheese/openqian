import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Amount } from "@/components/money";
import { refreshAllConnections } from "@/lib/connections/actions";
import { formatMoney } from "@/lib/money";
import { countConnections, getNetWorth } from "@/lib/queries";

export default async function Dashboard({ searchParams }: PageProps<"/">) {
  const { hidden } = await searchParams;
  const includeHidden = hidden === "1";
  const [nw, connectionCount] = await Promise.all([getNetWorth({ includeHidden }), countConnections()]);
  const cur = nw.baseCurrency;
  const hasAccounts = nw.categories.some((c) => c.accounts.length > 0);

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <p className="text-sm text-muted">Net worth</p>
        <p className="num mt-1 text-3xl font-semibold sm:text-4xl">{formatMoney(nw.netWorth, cur)}</p>
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted">Assets</p>
            <p className="num font-medium">{formatMoney(nw.assets, cur)}</p>
          </div>
          <div>
            <p className="text-muted">Debts</p>
            <p className="num font-medium">{formatMoney(nw.debts, cur)}</p>
          </div>
        </div>
        {connectionCount > 0 && (
          <ActionForm
            action={refreshAllConnections}
            submitLabel={`Refresh ${connectionCount} connection${connectionCount === 1 ? "" : "s"}`}
            submitClassName="btn"
            successMessage="Up to date"
            className="mt-4 space-y-2"
          >
            {null}
          </ActionForm>
        )}
      </section>

      {nw.missingRates.length > 0 && (
        <p className="rounded-lg bg-warning-bg px-4 py-3 text-sm text-warning-fg">
          Amounts in {nw.missingRates.join(", ")} aren&apos;t included in totals yet — exchange rates arrive in a
          later update.
        </p>
      )}

      {!hasAccounts && (
        <section className="card p-6 text-center">
          <p className="text-muted">No accounts yet.</p>
          <Link href="/accounts/new" className="btn-primary mt-4">
            Add your first account
          </Link>
        </section>
      )}

      {nw.categories
        .filter((c) => c.accounts.length > 0)
        .map(({ category, accounts, total }) => {
          const isDebt = category.kind === "debt";
          return (
            <section key={category.id} className="card overflow-hidden">
              <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
                <h2 className="font-medium">{category.name}</h2>
                <Amount base={total} baseCurrency={cur} negative={isDebt} />
              </header>
              <ul className="divide-y divide-border">
                {accounts.map((s) => (
                  <li key={s.account.id}>
                    <Link
                      href={`/accounts/${s.account.id}`}
                      className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-background ${
                        s.account.isExcluded || s.account.isHidden ? "opacity-60" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{s.account.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {[
                            s.account.institution,
                            s.isEmpty ? "No value yet" : s.asOf && `as of ${s.asOf}`,
                            s.account.isExcluded && "excluded",
                            s.account.isHidden && "hidden",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <Amount
                        base={s.base}
                        baseCurrency={cur}
                        native={s.native}
                        negative={isDebt}
                        unconverted={s.missingRates.length > 0 && s.base === 0}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

      {nw.hiddenCount > 0 && (
        <p className="text-center text-sm">
          <Link href={includeHidden ? "/" : "/?hidden=1"} className="text-muted underline">
            {includeHidden ? "Hide" : "Show"} {nw.hiddenCount} hidden account{nw.hiddenCount === 1 ? "" : "s"}
          </Link>
        </p>
      )}
    </div>
  );
}
