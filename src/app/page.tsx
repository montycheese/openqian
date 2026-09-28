import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { HistoryCard } from "@/components/history-card";
import { refreshAll } from "@/lib/refresh";
import { formatFullDate, parseRange, pointsSince, rangeHref, withLatestPoint, type ChartPoint } from "@/lib/chart";
import { localDate } from "@/lib/dates";
import { rangeStart, type HistoryRange } from "@/lib/history";
import { formatMoney } from "@/lib/money";
import { Sensitive } from "@/components/sensitive";
import { countSyncedSources, getNetWorth, getNetWorthSeries } from "@/lib/queries";
import { CoinEmblem, GradeLegend, Ingot, MilestoneCoins, Slot, spriteForAccount } from "@/components/treasury";
import { CATEGORY_ZH, gradeFor, nextMilestone, slotName, stackColor, stackLabel } from "@/lib/treasury";

export default async function Dashboard({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const includeHidden = params.hidden === "1";
  const range = parseRange(params.range);
  const [nw, sources, series] = await Promise.all([
    getNetWorth({ includeHidden }),
    countSyncedSources(),
    getNetWorthSeries(),
  ]);
  const cur = nw.baseCurrency;
  const hasAccounts = nw.categories.some((c) => c.accounts.length > 0);
  const query = { hidden: includeHidden ? "1" : undefined };

  const milestone = nextMilestone(nw.netWorth);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[330px_minmax(0,1fr)] lg:items-start">
      <aside aria-label="Net worth" className="card flex flex-col gap-4 p-5">
        <div className="flex items-center gap-4 border-b border-[#d8c49a] pb-4 lg:flex-col lg:text-center">
          <Ingot size={84} />
          <div>
            <p className="text-sm text-muted">
              Net worth <span className="brush text-lacquer">净资产</span>
            </p>
            <p className="num text-2xl sm:text-3xl">
              <Sensitive>{formatMoney(nw.netWorth, cur, { whole: true })}</Sensitive>
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-1.5 text-sm">
          <dt className="text-muted">Assets</dt>
          <dd className="num font-semibold">
            <Sensitive>{formatMoney(nw.assets, cur, { whole: true })}</Sensitive>
          </dd>
          <dt className="text-muted">
            Debts <span className="brush text-lacquer">债务</span>
          </dt>
          <dd className="num font-semibold text-negative">
            <Sensitive>{formatMoney(-nw.debts, cur, { whole: true })}</Sensitive>
          </dd>
        </dl>
        {milestone && (
          <MilestoneCoins progress={milestone.progress} target={milestone.target} remaining={milestone.target - nw.netWorth} currency={cur} />
        )}
        {hasAccounts && (
          <ActionForm action={refreshAll} submitLabel="Refresh all" submitClassName="btn-primary w-full" className="space-y-2">
            <p className="text-xs text-muted">
              Updates{" "}
              {[
                sources.exchanges > 0 && `${sources.exchanges} exchange${sources.exchanges === 1 ? "" : "s"}`,
                sources.wallets > 0 && `${sources.wallets} wallet${sources.wallets === 1 ? "" : "s"}`,
                "market prices",
              ]
                .filter(Boolean)
                .join(", ")}{" "}
              and exchange rates.
            </p>
          </ActionForm>
        )}
        {hasAccounts && (
          <div className="hidden lg:block">
            <GradeLegend />
          </div>
        )}
      </aside>

      <div className="min-w-0 space-y-5">
        {(hasAccounts || series.points.length > 0) && (
          <NetWorthHistory
            // End on the live total so the chart agrees with the panel beside it.
            points={hasAccounts ? withLatestPoint(series.points, localDate(), nw.netWorth) : series.points}
            currency={series.baseCurrency}
            range={range}
            hrefFor={(r) => rangeHref("/", query, r)}
          />
        )}

        {nw.missingRates.length > 0 && (
          <p className="border border-border bg-warning-bg px-4 py-3 text-sm text-warning-fg">
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
            <CoinEmblem size={56} />
            <p className="mt-3 text-muted">No accounts yet.</p>
            <Link href="/accounts/new" className="btn-primary mt-4">
              Add your first account
            </Link>
          </section>
        )}

        <div className="grid items-start gap-4 md:grid-cols-2">
          {nw.categories
            .filter((c) => c.accounts.length > 0)
            .map(({ category, accounts, total }) => {
              const isDebt = category.kind === "debt";
              const zh = CATEGORY_ZH[category.name];
              return (
                <section key={category.id} className="lacquer min-w-0 p-2.5" aria-label={category.name}>
                  <header className="flex items-baseline justify-between gap-2 px-1 pb-2">
                    <h2 className="pixel-shadow text-lg font-bold">
                      {category.name} {zh && <span className="brush font-normal text-[#f3d27a]">{zh}</span>}
                    </h2>
                    <span className="num pixel-shadow text-sm text-[#fff3c4]">
                      <Sensitive>{formatMoney(isDebt ? -total : total, cur)}</Sensitive>
                    </span>
                  </header>
                  <ul className="well grid grid-cols-3 gap-1.5 p-1.5 sm:grid-cols-4">
                    {accounts.map((s) => (
                      <li key={s.account.id} className="min-w-0">
                        <Slot
                          href={`/accounts/${s.account.id}`}
                          name={slotName(s.account.name, s.account.institution)}
                          title={[
                            s.account.name,
                            s.account.institution,
                            s.account.accountMask && `…${s.account.accountMask}`,
                            s.isEmpty ? "No value yet" : s.asOf && `as of ${s.asOf}`,
                            s.account.isExcluded && "excluded",
                            s.account.isHidden && "hidden",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          sprite={spriteForAccount(category.name, category.kind, `${s.account.name} ${s.account.institution ?? ""}`)}
                          stack={s.isEmpty ? "–" : <Sensitive>{stackLabel(s.base)}</Sensitive>}
                          stackColor={stackColor(s.base, isDebt)}
                          gradeColor={isDebt ? "#6b6258" : gradeFor(s.base, nw.assets).color}
                          dimmed={s.account.isExcluded || s.account.isHidden}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
        </div>

        {nw.hiddenCount > 0 && (
          <p className="text-center text-sm">
            <Link href={rangeHref("/", { hidden: includeHidden ? undefined : "1" }, range)} className="text-muted underline">
              {includeHidden ? "Hide" : "Show"} {nw.hiddenCount} hidden account{nw.hiddenCount === 1 ? "" : "s"}
            </Link>
          </p>
        )}
      </div>
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
            <span className="num font-bold"><Sensitive>{formatMoney(only.value, currency)}</Sensitive></span>{" "}
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
