import Link from "next/link";
import { HistoryChart } from "@/components/history-chart";
import { Sensitive } from "@/components/sensitive";
import { computeChange, describeTrend, formatChange, RANGE_LABELS, type ChartPoint } from "@/lib/chart";
import { HISTORY_RANGES, type HistoryRange } from "@/lib/history";

type Props = {
  title: string;
  currency: string;
  /** Points in the selected range, oldest first. */
  points: ChartPoint[];
  range: HistoryRange;
  /** Link for each range option. */
  hrefFor: (range: HistoryRange) => string;
  /** An increase is bad news, e.g. a debt balance. */
  invert?: boolean;
};

/** Card with a range selector, the change over the range, and the chart. */
export function HistoryCard({ title, currency, points, range, hrefFor, invert }: Props) {
  const change = computeChange(points);
  const good = change && change.absolute !== 0 ? change.absolute > 0 !== Boolean(invert) : null;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-sm text-muted">{title}</h2>
          {change && (
            <p className="mt-1 text-sm">
              <span className={`num font-medium ${good === null ? "" : good ? "text-positive" : "text-negative"}`}>
                <Sensitive>{formatChange(change, currency)}</Sensitive>
              </span>{" "}
              <span className="text-muted">{RANGE_LABELS[range].long}</span>
            </p>
          )}
        </div>
        <RangeTabs range={range} hrefFor={hrefFor} />
      </div>
      <div className="mt-4">
        {points.length >= 2 ? (
          <HistoryChart points={points} currency={currency} summary={describeTrend(title, points, currency)} />
        ) : (
          <p className="flex h-24 items-center justify-center text-sm text-muted">
            Not enough history in this range yet.
          </p>
        )}
      </div>
    </section>
  );
}

function RangeTabs({ range, hrefFor }: { range: HistoryRange; hrefFor: (range: HistoryRange) => string }) {
  return (
    <nav aria-label="Time range" className="flex border border-border p-0.5 text-xs">
      {HISTORY_RANGES.map((r) => {
        const current = r === range;
        return (
          <Link
            key={r}
            href={hrefFor(r)}
            scroll={false}
            replace
            aria-current={current ? "true" : undefined}
            aria-label={RANGE_LABELS[r].long[0].toUpperCase() + RANGE_LABELS[r].long.slice(1)}
            className={`px-2.5 py-1.5 font-medium focus-visible:outline-2 focus-visible:outline-accent ${
              current ? "bg-accent text-accent-fg" : "text-muted hover:text-foreground"
            }`}
          >
            {RANGE_LABELS[r].short}
          </Link>
        );
      })}
    </nav>
  );
}
