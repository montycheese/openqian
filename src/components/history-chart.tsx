"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { dateTicks, formatAxisMoney, formatFullDate, toTime, type ChartPoint } from "@/lib/chart";
import { formatMoney } from "@/lib/money";

type Props = {
  points: ChartPoint[];
  currency: string;
  /** Screen-reader summary of the trend. */
  summary: string;
  /** Draw steps: the value holds until the next point (manual valuations). */
  step?: boolean;
};

const tick = { fill: "var(--muted)", fontSize: 12 };

/** Single-series area chart of a value over time. Needs at least two points. */
export function HistoryChart({ points, currency, summary, step }: Props) {
  const data = points.map((p) => ({ t: toTime(p.date), value: p.value }));
  const { ticks, format } = dateTicks(data[0].t, data[data.length - 1].t);

  return (
    <figure className="h-48 w-full sm:h-56" aria-label={summary}>
      <AreaChart
        responsive
        data={data}
        style={{ width: "100%", height: "100%" }}
        margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
        accessibilityLayer
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          ticks={ticks}
          tickFormatter={format}
          tick={tick}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          minTickGap={12}
          interval="preserveStartEnd"
        />
        <YAxis
          width="auto"
          domain={["auto", "auto"]}
          tickFormatter={(v: number) => formatAxisMoney(v, currency)}
          tick={tick}
          tickLine={false}
          axisLine={false}
          tickCount={4}
        />
        <Tooltip
          cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
          content={(props) => <ChartTooltip {...props} currency={currency} />}
          isAnimationActive={false}
        />
        <Area
          dataKey="value"
          type={step ? "stepAfter" : "monotone"}
          stroke="var(--accent)"
          strokeWidth={2}
          fill="var(--accent)"
          fillOpacity={0.1}
          baseValue="dataMin"
          activeDot={{ r: 4, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2 }}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </figure>
  );
}

function ChartTooltip({
  active,
  payload,
  currency,
}: Pick<TooltipContentProps<ValueType, NameType>, "active" | "payload"> & { currency: string }) {
  const item = payload?.[0];
  if (!active || !item) return null;
  const { t, value } = item.payload as { t: number; value: number };
  return (
    <div className="card px-3 py-2 text-sm shadow-sm">
      <p className="num font-semibold">{formatMoney(value, currency)}</p>
      <p className="text-xs text-muted">{formatFullDate(t)}</p>
    </div>
  );
}
