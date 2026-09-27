export const DEFAULT_BASE_CURRENCY = "USD";

const COMMON = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "CNY", "HKD", "SGD", "TWD", "INR"];

/** Common currencies first, then every ISO 4217 code the runtime knows. */
export function currencyOptions(): string[] {
  const all = Intl.supportedValuesOf("currency");
  return [...COMMON, ...all.filter((c) => !COMMON.includes(c))];
}

export function formatMoney(amount: number, currency: string, opts: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 2,
  }).format(amount);
}

export function formatNumber(n: number, maxFractionDigits = 6): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFractionDigits }).format(n);
}

/** Converts an amount into the base currency, or null when no rate is known. */
export type Converter = (amount: number, currency: string) => number | null;

/** Converts only amounts already in the base currency (see lib/fx for real rates). */
export function sameCurrencyConverter(base: string): Converter {
  return (amount, currency) => (currency === base ? amount : null);
}
