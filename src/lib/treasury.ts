/** Border colour of an item by its share of total assets (vermilion ≥ 20% down to white jade). */
export const GRADES = [
  { min: 0.2, color: "#c0392b", zh: "朱", label: "20% or more" },
  { min: 0.1, color: "#d4a84b", zh: "金", label: "10–20%" },
  { min: 0.05, color: "#0f7a4f", zh: "翠", label: "5–10%" },
  { min: 0.01, color: "#7fb89a", zh: "青玉", label: "1–5%" },
  { min: 0, color: "#e3e0d2", zh: "白玉", label: "Under 1%" },
] as const;

export function gradeFor(value: number, totalAssets: number) {
  const share = totalAssets > 0 ? Math.max(0, value) / totalAssets : 0;
  return GRADES.find((g) => share >= g.min) ?? GRADES[GRADES.length - 1];
}

/**
 * The milestone after `netWorth`: the next multiple of its leading digit's place
 * value (360,167 → 400,000; 12,345 → 20,000), and how far the current step is done.
 */
export function nextMilestone(netWorth: number): { target: number; previous: number; progress: number } | null {
  if (!(netWorth > 0)) return null;
  const step = 10 ** Math.floor(Math.log10(netWorth));
  const previous = Math.floor(netWorth / step) * step;
  return { target: previous + step, previous, progress: (netWorth - previous) / step };
}

/** Chinese label shown beside each default category name. */
export const CATEGORY_ZH: Record<string, string> = {
  Cash: "现金",
  Investments: "股票",
  Retirement: "养老",
  Crypto: "加密货币",
  "Private Equity": "股权",
  "Real Estate": "房产",
  "Other Assets": "其他",
  "Credit Cards": "信用卡",
  Loans: "贷款",
  Mortgages: "房贷",
};
