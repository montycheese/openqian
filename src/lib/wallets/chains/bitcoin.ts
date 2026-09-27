import { createHash } from "node:crypto";
import type { ChainAdapter, ChainBalance, FetchContext } from "../types";

// --- bech32 / bech32m (BIP-173, BIP-350) ---

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= gen[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const codes = [...hrp].map((c) => c.charCodeAt(0));
  return [...codes.map((c) => c >> 5), 0, ...codes.map((c) => c & 31)];
}

function isValidSegwit(address: string): boolean {
  if (address.length > 90 || (address !== address.toLowerCase() && address !== address.toUpperCase())) return false;
  const lower = address.toLowerCase();
  const sep = lower.lastIndexOf("1");
  if (lower.slice(0, sep) !== "bc" || lower.length - sep - 1 < 6) return false; // mainnet only
  const data: number[] = [];
  for (const c of lower.slice(sep + 1)) {
    const v = BECH32_CHARSET.indexOf(c);
    if (v < 0) return false;
    data.push(v);
  }
  const version = data[0];
  if (version === undefined || version > 16) return false;
  // Witness v0 uses bech32; v1+ (Taproot and later) use bech32m.
  const expected = version === 0 ? BECH32_CONST : BECH32M_CONST;
  if (polymod([...hrpExpand("bc"), ...data]) !== expected) return false;

  // Regroup the 5-bit program words into bytes; leftover padding must be < 5 zero bits.
  let acc = 0;
  let bits = 0;
  let programLength = 0;
  for (const v of data.slice(1, -6)) {
    acc = ((acc << 5) | v) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      programLength++;
    }
  }
  if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) return false;
  if (programLength < 2 || programLength > 40) return false;
  return version !== 0 || programLength === 20 || programLength === 32;
}

// --- base58check (legacy P2PKH / P2SH) ---

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(input: string): Uint8Array | null {
  const bytes: number[] = []; // little-endian
  for (const char of input) {
    let carry = BASE58_ALPHABET.indexOf(char);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < input.length && input[i] === "1"; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();

function isValidBase58Check(address: string): boolean {
  const bytes = base58Decode(address);
  // Mainnet version bytes: 0x00 = P2PKH ("1..."), 0x05 = P2SH ("3...").
  if (!bytes || bytes.length !== 25 || (bytes[0] !== 0x00 && bytes[0] !== 0x05)) return false;
  const checksum = sha256(sha256(bytes.subarray(0, 21)));
  return checksum.subarray(0, 4).equals(bytes.subarray(21));
}

// --- balances (Esplora API) ---

const TIMEOUT_MS = 15_000;

type AddressStats = { funded_txo_sum: number; spent_txo_sum: number };

async function fetchFrom(baseUrl: string, address: string, ctx: FetchContext): Promise<ChainBalance[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await ctx.fetch(`${baseUrl.replace(/\/+$/, "")}/address/${address}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { chain_stats: AddressStats; mempool_stats: AddressStats };
    const net = (s: AddressStats) => s.funded_txo_sum - s.spent_txo_sum;
    // Includes unconfirmed (mempool) activity so a just-sent payment shows up immediately.
    const sats = net(body.chain_stats) + net(body.mempool_stats);
    if (!Number.isFinite(sats)) throw new Error("Malformed Esplora response");
    return sats > 0 ? [{ symbol: "BTC", name: "Bitcoin", amount: sats / 1e8, contract: null, coingeckoId: "bitcoin" }] : [];
  } finally {
    clearTimeout(timer);
  }
}

// Single addresses only; xpub/descriptor (HD wallet) support is a future extension.
export const bitcoin: ChainAdapter = {
  id: "bitcoin",
  label: "Bitcoin",
  family: "bitcoin",
  defaultRpcUrls: ["https://mempool.space/api", "https://blockstream.info/api"],
  coingeckoPlatform: null,
  normalizeAddress(input) {
    const address = input.trim();
    if (/^bc1/i.test(address)) return isValidSegwit(address) ? address.toLowerCase() : null;
    return isValidBase58Check(address) ? address : null;
  },
  async fetchBalances(address, ctx) {
    for (const url of ctx.rpcUrls) {
      try {
        return await fetchFrom(url, address, ctx);
      } catch {
        // Try the next endpoint.
      }
    }
    throw new Error("Couldn't reach Bitcoin API endpoints");
  },
  explorerUrl: (address) => `https://mempool.space/address/${address}`,
};
