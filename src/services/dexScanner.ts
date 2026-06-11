// ============================================================
// DexScanner — Cari token baru < 24 jam dari DexScreener
// ============================================================

import { CONFIG } from '../config/index';
import { Token } from '../types/index';
import { logger, createContextLogger } from '../utils/logger';
import { validateAddress } from '../utils/helpers';

const dexLog = createContextLogger('dexscanner');

const SEARCH_API = 'https://api.dexscreener.com/latest/dex/search';
const BOOST_API = 'https://api.dexscreener.com/token-boosts/top/v1';

// ─── Response types ──────────────────────────────────────────────────────────

interface DexPair {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  liquidity: { usd: number };
  volume: { h24: number };
  pairCreatedAt: number;
  fdv: number;
}

interface BoostEntry {
  chainId: string;
  tokenAddress: string;
}

interface SearchResponse {
  pairs: DexPair[] | null;
}

// ─── Converter ───────────────────────────────────────────────────────────────

function toToken(pair: DexPair): Token {
  const ageMs = Date.now() - (pair.pairCreatedAt || Date.now());
  const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));

  return {
    address: pair.baseToken.address.toLowerCase(),
    name: pair.baseToken.name || 'Unknown',
    symbol: pair.baseToken.symbol || '???',
    pairSymbol: `${pair.baseToken.symbol || '?'}/${pair.quoteToken?.symbol || '?'}`,
    liquidityUsd: pair.liquidity?.usd ?? 0,
    volume24h: pair.volume?.h24 ?? 0,
    ageHours,
    priceUsd: parseFloat(pair.priceUsd || '0'),
    decimals: 18,
  };
}

function isQualified(token: Token): boolean {
  return (
    token.liquidityUsd >= CONFIG.minLiquidityUsd &&
    token.liquidityUsd <= CONFIG.maxLiquidityUsd &&
    token.volume24h >= CONFIG.minVolume24hUsd &&
    token.ageHours <= CONFIG.maxTokenAgeHours
  );
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

/**
 * Cari token baru di Base chain via DexScreener.
 *
 * Sumber:
 *   1. Token boosts (trending)
 *   2. Search query "base" + "coinbase"
 *
 * Filter: liquidity $10K-$500K, volume > $50K, age < 24 jam.
 *
 * Kalau API error → return array kosong (tidak crash).
 */
export async function discoverNewTokens(): Promise<Token[]> {
  const allPairs: DexPair[] = [];

  // ── Source 1: Token boosts ──────────────────────────────────────────────
  try {
    const boostRes = await fetch(BOOST_API, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (boostRes.ok) {
      const boosts = (await boostRes.json()) as BoostEntry[];
      const baseBoosts = boosts.filter((b) => b.chainId === 'base');

      // Cari detail tiap boosted token via search
      for (const boost of baseBoosts.slice(0, 10)) {
        try {
          const pair = await fetchPairByAddress(boost.tokenAddress);
          if (pair) allPairs.push(pair);
        } catch {
          // skip kalo gagal fetch detail
        }
      }
    }
  } catch (err) {
    dexLog.error('Gagal fetch token boosts', { error: String(err) });
  }

  // ── Source 2: Search ────────────────────────────────────────────────────
  for (const query of ['base', 'coinbase', 'aerodrome']) {
    try {
      const pairs = await searchPairs(query);
      allPairs.push(...pairs);
    } catch (err) {
      dexLog.error(`Gagal search "${query}"`, { error: String(err) });
    }
  }

  // ── Deduplikasi & filter ────────────────────────────────────────────────
  const seen = new Set<string>();
  const tokens: Token[] = [];

  for (const pair of allPairs) {
    const addr = pair.baseToken.address?.toLowerCase();
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);

    const token = toToken(pair);
    if (isQualified(token)) {
      tokens.push(token);
    }
  }

  // Urutkan: termuda dulu
  tokens.sort((a, b) => a.ageHours - b.ageHours);

  dexLog.info(`Ditemukan ${tokens.length} token qualified dari ${seen.size} unique`);
  return tokens;
}

/**
 * Cari detail pair dari address token lewat search endpoint
 */
async function fetchPairByAddress(address: string): Promise<DexPair | null> {
  if (!validateAddress(address)) return null;

  const url = `${SEARCH_API}?q=${encodeURIComponent(address)}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as SearchResponse;
  const pairs = data.pairs || [];

  // Ambil pair Base dengan liquidity tertinggi
  const basePairs = pairs.filter((p) => p.chainId === 'base');
  if (basePairs.length === 0) return null;

  basePairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return basePairs[0];
}

/**
 * Search token di DexScreener
 */
async function searchPairs(query: string): Promise<DexPair[]> {
  const url = `${SEARCH_API}?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) return [];

  const data = (await res.json()) as SearchResponse;
  return (data.pairs || []).filter((p) => p.chainId === 'base');
}

export default discoverNewTokens;
