"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { dateTicks, formatFullDate, toTime, valueAxis, type ChartPoint } from "@/lib/chart";
import { usePrivateMode } from "@/components/privacy";
import { MASK } from "@/components/sensitive";
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
  const hidden = usePrivateMode();
  const data = points.map((p) => ({ t: toTime(p.date), value: p.value }));
  const { ticks, format } = dateTicks(data[0].t, data[data.length - 1].t);
  const y = valueAxis(
    data.map((d) => d.value),
    currency,
  );

  return (
    <figure className="h-48 w-full sm:h-56" aria-label={hidden ? "Value over time (amounts hidden in private mode)" : summary}>
      <AreaChart
        responsive
        data={data}
        style={{ width: "100%", height: "100%" }}
        margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
        accessibilityLayer
      >
        <CartesianGrid vertical={false} stroke="#d8c49a" strokeDasharray="2 4" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          ticks={ticks}
          tickFormatter={format}
          tick={tick}
          tickLine={false}
          tickMargin={6}
          axisLine={{ stroke: "var(--border)" }}
          minTickGap={12}
          interval="preserveStartEnd"
        />
        <YAxis
          hide={hidden}
          width="auto"
          domain={y.domain}
          ticks={y.ticks}
          tickFormatter={y.format}
          tick={tick}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
          content={(props) => <ChartTooltip {...props} currency={currency} hidden={hidden} />}
          isAnimationActive={false}
        />
        <Area
          dataKey="value"
          type={step ? "stepAfter" : "monotone"}
          // Ink brush stroke on paper; the active point is a red seal dot.
          stroke="var(--ink)"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="var(--ink)"
          fillOpacity={0.05}
          baseValue="dataMin"
          activeDot={{ r: 5, fill: "#c0392b", stroke: "var(--surface)", strokeWidth: 2 }}
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
  hidden,
}: Pick<TooltipContentProps<ValueType, NameType>, "active" | "payload"> & { currency: string; hidden: boolean }) {
  const item = payload?.[0];
  if (!active || !item) return null;
  const { t, value } = item.payload as { t: number; value: number };
  return (
    <div className="card px-3 py-2 text-sm shadow-sm">
      <p className="num font-semibold">{hidden ? MASK : formatMoney(value, currency)}</p>
      <p className="text-xs text-muted">{formatFullDate(t)}</p>
    </div>
  );
}
