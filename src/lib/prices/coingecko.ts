import { z } from "zod";
import { isoDate, type PriceProvider, type Quote } from "./types";

const API = "https://api.coingecko.com/api/v3";

/**
 * CoinGecko ids for common tickers. Tickers aren't unique on CoinGecko (dozens
 * of coins call themselves "UNI"), so well-known ones are pinned here.
 */
export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  BNB: "binancecoin",
  DOGE: "dogecoin",
  ADA: "cardano",
  TRX: "tron",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  DOT: "polkadot",
  TON: "the-open-network",
  SHIB: "shiba-inu",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  XLM: "stellar",
  UNI: "uniswap",
  NEAR: "near",
  ATOM: "cosmos",
  XMR: "monero",
  ETC: "ethereum-classic",
  APT: "aptos",
  SUI: "sui",
  HBAR: "hedera-hashgraph",
  FIL: "filecoin",
  ICP: "internet-computer",
  ARB: "arbitrum",
  OP: "optimism",
  POL: "polygon-ecosystem-token",
  MATIC: "matic-network",
  AAVE: "aave",
  ALGO: "algorand",
  PEPE: "pepe",
  WBTC: "wrapped-bitcoin",
  STETH: "staked-ether",
  HYPE: "hyperliquid",
  RENDER: "render-token",
  XTZ: "tezos",
};

// { "<id or lowercase symbol>": { usd: 123.4, last_updated_at: 1790000000 } }
const simplePrice = z.record(
  z.string(),
  z.object({ usd: z.number().positive().finite().optional(), last_updated_at: z.number().optional() }),
);

type Fetch = typeof fetch;

async function getPrices(fetchImpl: Fetch, param: "ids" | "symbols", values: string[]) {
  const url = `${API}/simple/price?${param}=${encodeURIComponent(values.join(","))}&vs_currencies=usd&include_last_updated_at=true`;
  const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 429) throw new Error("rate limit reached, try again in a minute");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return simplePrice.parse(await res.json());
}

function toQuote(entry: z.infer<typeof simplePrice>[string] | undefined, now: Date): Quote | undefined {
  if (!entry?.usd) return undefined;
  const at = entry.last_updated_at ? new Date(entry.last_updated_at * 1000) : now;
  return { price: entry.usd, currency: "USD", date: isoDate(at) };
}

export function createCoinGeckoProvider(fetchImpl: Fetch = (input, init) => fetch(input, init)): PriceProvider {
  return {
    id: "coingecko",
    label: "CoinGecko",
    kind: "crypto",
    async fetchQuotes(symbols) {
      const now = new Date();
      const quotes = new Map<string, Quote>();
      const known = symbols.filter((s) => COINGECKO_IDS[s]);
      const unknown = symbols.filter((s) => !COINGECKO_IDS[s]);

      // At most two requests: pinned ids, then a symbol lookup for the rest,
      // which CoinGecko resolves to the top-ranked coin with that ticker.
      if (known.length > 0) {
        const data = await getPrices(fetchImpl, "ids", known.map((s) => COINGECKO_IDS[s]));
        for (const s of known) {
          const q = toQuote(data[COINGECKO_IDS[s]], now);
          if (q) quotes.set(s, q);
        }
      }
      if (unknown.length > 0) {
        const data = await getPrices(fetchImpl, "symbols", unknown.map((s) => s.toLowerCase()));
        for (const s of unknown) {
          const q = toQuote(data[s.toLowerCase()], now);
          if (q) quotes.set(s, q);
        }
      }
      return quotes;
    },
  };
}

export const coinGeckoProvider = createCoinGeckoProvider();
