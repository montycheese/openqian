import { describe, expect, it } from "vitest";
import {
  computeChange,
  dateTicks,
  describeTrend,
  formatAxisMoney,
  formatChange,
  parseRange,
  rangeHref,
  toTime,
  valuationSeries,
  valueAxis,
} from "@/lib/chart";

describe("parseRange", () => {
  it("accepts known ranges and defaults to 3m", () => {
    expect(parseRange("1y")).toBe("1y");
    expect(parseRange("all")).toBe("all");
    expect(parseRange(["6m", "1m"])).toBe("6m");
    expect(parseRange(undefined)).toBe("3m");
    expect(parseRange("5y")).toBe("3m");
    expect(parseRange("toString")).toBe("3m");
  });
});

describe("rangeHref", () => {
  it("keeps other params and drops the default range", () => {
    expect(rangeHref("/", { hidden: "1" }, "all")).toBe("/?hidden=1&range=all");
    expect(rangeHref("/", { hidden: "1", range: "all" }, "3m")).toBe("/?hidden=1");
    expect(rangeHref("/accounts/a", {}, "3m")).toBe("/accounts/a");
    expect(rangeHref("/", { hidden: undefined }, "1m")).toBe("/?range=1m");
  });
});

describe("computeChange", () => {
  it("needs two points", () => {
    expect(computeChange([])).toBeNull();
    expect(computeChange([{ date: "2026-01-01", value: 5 }])).toBeNull();
  });

  it("measures first to last", () => {
    const c = computeChange([
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-02", value: 90 },
      { date: "2026-01-03", value: 125 },
    ]);
    expect(c).toEqual({ absolute: 25, percent: 0.25 });
  });

  it("uses the magnitude of a negative start and has no percent from zero", () => {
    expect(computeChange([{ date: "a", value: -100 }, { date: "b", value: -50 }])).toEqual({ absolute: 50, percent: 0.5 });
    expect(computeChange([{ date: "a", value: 0 }, { date: "b", value: 50 }])).toEqual({ absolute: 50, percent: null });
  });
});

describe("formatChange", () => {
  it("signs amount and percent", () => {
    expect(formatChange({ absolute: 1234.5, percent: 0.0234 }, "USD")).toBe("+$1,234.50 (+2.3%)");
    expect(formatChange({ absolute: -50, percent: -0.5 }, "USD")).toBe("−$50.00 (−50%)");
    expect(formatChange({ absolute: 0, percent: 0 }, "USD")).toBe("$0.00 (0%)");
    expect(formatChange({ absolute: 10, percent: null }, "EUR")).toBe("+€10.00");
  });
});

describe("formatAxisMoney", () => {
  it("is compact", () => {
    expect(formatAxisMoney(1_234_567, "USD")).toBe("$1.2M");
    expect(formatAxisMoney(950_000, "USD")).toBe("$950K");
    expect(formatAxisMoney(-50_000, "USD")).toBe("-$50K");
    expect(formatAxisMoney(0, "USD")).toBe("$0");
  });
});

describe("valueAxis", () => {
  it("uses round steps that cover the data", () => {
    const axis = valueAxis([1_193_977, 1_238_100], "USD");
    expect(axis.ticks).toEqual([1_180_000, 1_200_000, 1_220_000, 1_240_000]);
    expect(axis.domain).toEqual([1_180_000, 1_240_000]);
  });

  it("adds decimals until tick labels differ", () => {
    const axis = valueAxis([1_193_977, 1_238_100], "USD");
    expect(axis.ticks.map(axis.format)).toEqual(["$1.18M", "$1.2M", "$1.22M", "$1.24M"]);
    const wide = valueAxis([0, 3000], "USD");
    expect(wide.ticks.map(wide.format)).toEqual(["$0", "$1K", "$2K", "$3K"]);
  });

  it("pads a flat series", () => {
    const axis = valueAxis([100, 100], "USD");
    expect(axis.domain[0]).toBeLessThan(100);
    expect(axis.domain[1]).toBeGreaterThan(100);
  });
});

describe("dateTicks", () => {
  it("spreads whole days evenly and labels days for short spans", () => {
    const { ticks, format } = dateTicks(toTime("2026-09-01"), toTime("2026-09-09"), 5);
    expect(ticks.map((t) => new Date(t).toISOString().slice(0, 10))).toEqual([
      "2026-09-01",
      "2026-09-03",
      "2026-09-05",
      "2026-09-07",
      "2026-09-09",
    ]);
    expect(format(ticks[0])).toBe("Sep 1");
    expect(format(toTime("2026-09-27"))).toBe("Sep 27");
  });

  it("never has more ticks than days", () => {
    expect(dateTicks(toTime("2026-09-01"), toTime("2026-09-02"), 5).ticks).toHaveLength(2);
    expect(dateTicks(toTime("2026-09-01"), toTime("2026-09-01"), 5).ticks).toHaveLength(1);
  });

  it("labels months for long spans", () => {
    const { ticks, format } = dateTicks(toTime("2025-09-27"), toTime("2026-09-27"), 4);
    expect(format(ticks[0])).toBe("Sep ’25");
    expect(format(ticks[3])).toBe("Sep ’26");
  });
});

describe("valuationSeries", () => {
  const v = (date: string, value: number, createdAt = 0, currency = "USD") => ({ date, value, currency, createdAt });

  it("is empty without valuations", () => {
    expect(valuationSeries([], { start: null, today: "2026-09-27" })).toEqual({ currency: null, points: [], observations: 0 });
  });

  it("keeps the latest entry per day and carries the last value to today", () => {
    const s = valuationSeries([v("2026-09-10", 200), v("2026-09-01", 100, 1), v("2026-09-01", 150, 2)], {
      start: null,
      today: "2026-09-27",
    });
    expect(s.observations).toBe(2);
    expect(s.points).toEqual([
      { date: "2026-09-01", value: 150 },
      { date: "2026-09-10", value: 200 },
      { date: "2026-09-27", value: 200 },
    ]);
  });

  it("opens the range with the value in force at its start", () => {
    const s = valuationSeries([v("2026-01-01", 100), v("2026-09-10", 200)], { start: "2026-08-27", today: "2026-09-27" });
    expect(s.points).toEqual([
      { date: "2026-08-27", value: 100 },
      { date: "2026-09-10", value: 200 },
      { date: "2026-09-27", value: 200 },
    ]);
  });

  it("uses the latest valuation's currency", () => {
    const s = valuationSeries([v("2026-01-01", 100, 0, "EUR"), v("2026-02-01", 90, 0, "USD")], {
      start: null,
      today: "2026-02-01",
    });
    expect(s.currency).toBe("USD");
    expect(s.points).toEqual([{ date: "2026-02-01", value: 90 }]);
  });
});

describe("describeTrend", () => {
  it("summarizes first, last, and direction", () => {
    expect(
      describeTrend(
        "Net worth",
        [
          { date: "2026-09-01", value: 100 },
          { date: "2026-09-27", value: 110 },
        ],
        "USD",
      ),
    ).toBe("Net worth: $100.00 on Sep 1, 2026 to $110.00 on Sep 27, 2026, a change of +$10.00 (+10%).");
    expect(describeTrend("Net worth", [], "USD")).toBe("Net worth: no history.");
  });
});
