export type PriceKind = "security" | "crypto";

export type Quote = {
  price: number;
  currency: string;
  /** YYYY-MM-DD the quote applies to. */
  date: string;
};

/**
 * A source of quotes. `fetchQuotes` returns a map keyed by the symbols it was
 * given; symbols it can't price are simply absent. It throws only when the
 * whole source is unusable (network down, rate limited, ...).
 */
export interface PriceProvider {
  /** Stored as `prices.source`. */
  id: string;
  /** Shown in error messages, e.g. "Yahoo Finance". */
  label: string;
  kind: PriceKind;
  fetchQuotes(symbols: string[]): Promise<Map<string, Quote>>;
}

/** YYYY-MM-DD of `at` in the given IANA time zone (UTC when unknown). */
export function isoDate(at: Date, timeZone = "UTC"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
