// Pure helpers for history charts. Safe to import from client components:
// keep imports type-only (apart from money formatting).
import type { HistoryRange } from "@/lib/history";
import { formatMoney } from "@/lib/money";

/** One value on one day (YYYY-MM-DD). */
export type ChartPoint = { date: string; value: number };

export const DEFAULT_RANGE: HistoryRange = "3m";

export const RANGE_LABELS: Record<HistoryRange, { short: string; long: string }> = {
  "1m": { short: "1M", long: "past month" },
  "3m": { short: "3M", long: "past 3 months" },
  "6m": { short: "6M", long: "past 6 months" },
  "1y": { short: "1Y", long: "past year" },
  all: { short: "All", long: "all time" },
};

/** Reads a `?range=` search param, falling back to the default. */
export function parseRange(value: string | string[] | undefined): HistoryRange {
  const v = Array.isArray(value) ? value[0] : value;
  return v && Object.hasOwn(RANGE_LABELS, v) ? (v as HistoryRange) : DEFAULT_RANGE;
}

/**
 * Link to `path` with the range set, keeping other params (e.g. `hidden`).
 * The default range is left out of the URL.
 */
export function rangeHref(path: string, params: Record<string, string | undefined>, range: HistoryRange): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && k !== "range") q.set(k, v);
  if (range !== DEFAULT_RANGE) q.set("range", range);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** Points on or after `start` (null keeps everything). Input must be oldest first. */
export function pointsSince(points: ChartPoint[], start: string | null): ChartPoint[] {
  if (!start) return points;
  const inRange = points.filter((p) => p.date >= start);
  // Open the range with the last value recorded before it, so the chart starts at the range's start.
  const before = points.filter((p) => p.date < start).at(-1);
  return before && inRange[0]?.date !== start ? [{ date: start, value: before.value }, ...inRange] : inRange;
}

export type Change = { absolute: number; percent: number | null };

/** Change from the first to the last point, or null with fewer than two. */
export function computeChange(points: ChartPoint[]): Change | null {
  if (points.length < 2) return null;
  const first = points[0].value;
  const absolute = points[points.length - 1].value - first;
  return { absolute, percent: first === 0 ? null : absolute / Math.abs(first) };
}

/** "+$1,234.00 (+2.3%)" style text for a change. */
export function formatChange(change: Change, currency: string): string {
  const sign = change.absolute > 0 ? "+" : change.absolute < 0 ? "−" : "";
  const amount = `${sign}${formatMoney(Math.abs(change.absolute), currency)}`;
  if (change.percent === null) return amount;
  const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(
    Math.abs(change.percent),
  );
  return `${amount} (${sign}${pct})`;
}

/** Compact money for axis ticks, e.g. "$1.2M". */
export function formatAxisMoney(value: number, currency: string, fractionDigits = 1): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * Round-number y-axis ticks covering `values`, and a compact formatter with
 * just enough decimals to tell the ticks apart ("$1.21M", "$1.22M", ...).
 */
export function valueAxis(
  values: number[],
  currency: string,
  count = 4,
): { ticks: number[]; domain: [number, number]; format: (v: number) => string } {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  let digits = 1;
  while (digits < 4 && new Set(ticks.map((t) => formatAxisMoney(t, currency, digits))).size < ticks.length) digits++;
  return { ticks, domain: [lo, hi], format: (v) => formatAxisMoney(v, currency, digits) };
}

const DAY_MS = 86_400_000;

/** Midnight UTC of a YYYY-MM-DD date, in ms. */
export function toTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

const dateFormats = {
  day: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  month: new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
  full: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
};

/** "Sep 27, 2026" for a YYYY-MM-DD date or a UTC ms time. */
export function formatFullDate(date: string | number): string {
  return dateFormats.full.format(typeof date === "string" ? toTime(date) : date);
}

/**
 * Evenly spaced whole-day ticks from `min` to `max` (UTC ms), at most `count`,
 * with a formatter suited to the span ("Sep 27" or "Sep 26" for month + year).
 */
export function dateTicks(min: number, max: number, count = 5): { ticks: number[]; format: (t: number) => string } {
  const days = Math.max(0, Math.round((max - min) / DAY_MS));
  const n = Math.max(1, Math.min(count, days + 1));
  const ticks =
    n === 1 ? [min] : Array.from({ length: n }, (_, i) => min + Math.round((days * i) / (n - 1)) * DAY_MS);
  const format =
    days > 120
      ? (t: number) => dateFormats.month.format(t).replace(/ (\d{2})$/, " ’$1")
      : (t: number) => dateFormats.day.format(t);
  return { ticks, format };
}

/**
 * Chart points for a "value" account from its dated valuations.
 * Uses the latest entry per day, in the currency of the latest valuation.
 * A value holds until the next one, so the value in force at `start` opens
 * the range and the latest value is carried to `today`.
 */
export function valuationSeries(
  valuations: { date: string; value: number; currency: string; createdAt: Date | number }[],
  opts: { start: string | null; today: string },
): { currency: string | null; points: ChartPoint[]; observations: number } {
  if (valuations.length === 0) return { currency: null, points: [], observations: 0 };
  const sorted = [...valuations].sort(
    (a, b) => a.date.localeCompare(b.date) || Number(a.createdAt) - Number(b.createdAt),
  );
  const currency = sorted[sorted.length - 1].currency;
  const byDate = new Map<string, number>();
  for (const v of sorted) if (v.currency === currency) byDate.set(v.date, v.value);
  const all = [...byDate].map(([date, value]) => ({ date, value }));

  const points = [...pointsSince(all, opts.start)];
  if (opts.start) {
    const before = all.filter((p) => p.date < opts.start!).at(-1);
    if (before && points[0]?.date !== opts.start) points.unshift({ date: opts.start, value: before.value });
  }
  const last = points.at(-1);
  if (last && last.date < opts.today) points.push({ date: opts.today, value: last.value });
  return { currency, points, observations: all.length };
}

/** One-sentence summary of a series, for screen readers. */
export function describeTrend(label: string, points: ChartPoint[], currency: string): string {
  if (points.length === 0) return `${label}: no history.`;
  const first = points[0];
  const last = points[points.length - 1];
  const change = computeChange(points);
  return (
    `${label}: ${formatMoney(first.value, currency)} on ${formatFullDate(first.date)} to ` +
    `${formatMoney(last.value, currency)} on ${formatFullDate(last.date)}` +
    (change && change.absolute !== 0 ? `, a change of ${formatChange(change, currency)}.` : ", unchanged.")
  );
}

/** Series ending with `value` on `date`, replacing any point already recorded for that day. */
export function withLatestPoint(points: ChartPoint[], date: string, value: number): ChartPoint[] {
  return [...points.filter((p) => p.date < date), { date, value }];
}
