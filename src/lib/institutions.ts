/** Suggestions for the institution field. Free text is still allowed. */
export const INSTITUTIONS = {
  Brokerages: [
    "Fidelity",
    "Charles Schwab",
    "Vanguard",
    "Robinhood",
    "Morgan Stanley",
    "E*TRADE",
    "Interactive Brokers",
    "Merrill",
    "J.P. Morgan",
    "Wealthfront",
    "Betterment",
    "SoFi Invest",
    "Public",
    "Webull",
    "M1 Finance",
    "Empower",
    "TIAA",
    "Principal",
  ],
  Banks: [
    "Chase",
    "Wells Fargo",
    "Bank of America",
    "Citi",
    "Capital One",
    "U.S. Bank",
    "PNC",
    "Truist",
    "Ally",
    "American Express",
    "Discover",
    "Marcus by Goldman Sachs",
    "SoFi",
    "Charles Schwab Bank",
  ],
  "Crypto exchanges": ["Coinbase", "Kraken", "Gemini", "Binance.US"],
} as const;

export const ALL_INSTITUTIONS: string[] = Object.values(INSTITUTIONS).flat();

/** Finds a known institution named in free text (e.g. an export's header). */
export function detectInstitution(text: string): string | null {
  const lower = text.toLowerCase();
  const byLength = [...ALL_INSTITUTIONS].sort((a, b) => b.length - a.length);
  return byLength.find((name) => lower.includes(name.toLowerCase())) ?? null;
}
