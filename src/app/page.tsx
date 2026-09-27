import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Amount } from "@/components/money";
import { HistoryCard } from "@/components/history-card";
import { refreshAll } from "@/lib/refresh";
import { formatFullDate, parseRange, pointsSince, rangeHref, type ChartPoint } from "@/lib/chart";
import { rangeStart, type HistoryRange } from "@/lib/history";
import { formatMoney } from "@/lib/money";
import { countConnections, getNetWorth, getNetWorthSeries } from "@/lib/queries";

export default async function Dashboard({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const includeHidden = params.hidden === "1";
  const range = parseRange(params.range);
  const [nw, connectionCount, series] = await Promise.all([
    getNetWorth({ includeHidden }),
    countConnections(),
    getNetWorthSeries(),
  ]);
  const cur = nw.baseCurrency;
  const hasAccounts = nw.categories.some((c) => c.accounts.length > 0);
  const query = { hidden: includeHidden ? "1" : undefined };

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
        {hasAccounts && (
          <ActionForm
            action={refreshAll}
            submitLabel="Refresh all"
            submitClassName="btn"
            className="mt-4 space-y-2"
          >
            <p className="text-xs text-muted">
              Updates{" "}
              {connectionCount > 0 ? `${connectionCount} exchange connection${connectionCount === 1 ? "" : "s"}, ` : ""}
              market prices{connectionCount > 0 ? "," : ""} and exchange rates.
            </p>
          </ActionForm>
        )}
      </section>

      {(hasAccounts || series.points.length > 0) && (
        <NetWorthHistory
          points={series.points}
          currency={series.baseCurrency}
          range={range}
          hrefFor={(r) => rangeHref("/", query, r)}
        />
      )}

      {nw.missingRates.length > 0 && (
        <p className="rounded-lg bg-warning-bg px-4 py-3 text-sm text-warning-fg">
          No exchange rate for {nw.missingRates.join(", ")}, so those amounts aren&apos;t in the totals. Click Refresh
          all, or{" "}
          <Link href="/settings" className="underline">
            set a rate in Settings
          </Link>
          .
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
                            s.account.accountMask && `…${s.account.accountMask}`,
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
          <Link
            href={rangeHref("/", { hidden: includeHidden ? undefined : "1" }, range)}
            className="text-muted underline"
          >
            {includeHidden ? "Hide" : "Show"} {nw.hiddenCount} hidden account{nw.hiddenCount === 1 ? "" : "s"}
          </Link>
        </p>
      )}
    </div>
  );
}

const HISTORY_NOTE = "Net worth history builds up each day you refresh or update values.";

function NetWorthHistory({
  points,
  currency,
  range,
  hrefFor,
}: {
  points: ChartPoint[];
  currency: string;
  range: HistoryRange;
  hrefFor: (range: HistoryRange) => string;
}) {
  if (points.length < 2) {
    const only = points[0];
    return (
      <section className="card p-5">
        <h2 className="text-sm text-muted">Net worth over time</h2>
        {only && (
          <p className="mt-1 text-sm">
            <span className="num font-medium">{formatMoney(only.value, currency)}</span>{" "}
            <span className="text-muted">on {formatFullDate(only.date)}</span>
          </p>
        )}
        <p className="mt-2 text-sm text-muted">{HISTORY_NOTE}</p>
      </section>
    );
  }
  return (
    <HistoryCard
      title="Net worth over time"
      currency={currency}
      points={pointsSince(points, rangeStart(range))}
      range={range}
      hrefFor={hrefFor}
    />
  );
}
