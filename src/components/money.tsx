import { formatMoney } from "@/lib/money";

/** Base-currency amount, with the native amount alongside when it differs. */
export function Amount({
  base,
  baseCurrency,
  native,
  negative,
  unconverted,
}: {
  base: number;
  baseCurrency: string;
  native?: { amount: number; currency: string } | null;
  negative?: boolean;
  /** No exchange rate for this amount, so the base value isn't meaningful. */
  unconverted?: boolean;
}) {
  const showNative = native && native.currency !== baseCurrency;
  return (
    <span className="num text-right">
      {unconverted ? (
        <span className="text-muted" title="No exchange rate yet">
          —
        </span>
      ) : (
        <span className={negative ? "text-negative" : undefined}>
          {negative && base !== 0 ? "−" : ""}
          {formatMoney(base, baseCurrency)}
        </span>
      )}
      {showNative && (
        <span className="block text-xs text-muted">{formatMoney(native.amount, native.currency)}</span>
      )}
    </span>
  );
}
