import { createContextLogger } from '../utils/logger';

const athLog = createContextLogger('athScanner');

// ─── Types ──────────────────────────────────────────────────────────────────

interface Candle {
  timestamp: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ScannedToken {
  address: string;
  name: string;
  symbol: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24h: number;
  athPrice: number;
  dropPercent: number;
  pairAddress: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SEARCH_API = 'https://api.dexscreener.com/latest/dex/search';
const BOOST_API = 'https://api.dexscreener.com/token-boosts/top/v1';
const CANDLES_API = 'https://api.dexscreener.com/latest/dex/candles/base';

const SEARCH_KEYWORDS = [
  'base', 'coinbase', 'aerodrome', 'usdc', 'weth',
  'cbBTC', 'morpho', 'aave', 'uniswap',
];

// ─── Fetch boosted tokens ──────────────────────────────────────────────────

async function fetchBoostedTokens(): Promise<any[]> {
  try {
    const res = await fetch(BOOST_API, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    return data.filter((t: any) => t.chainId === 'base');
  } catch {
    return [];
  }
}

// ─── Search pairs by keyword ───────────────────────────────────────────────

async function searchPairs(query: string): Promise<any[]> {
  try {
    const url = `${SEARCH_API}?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.pairs || []).filter((p: any) => p.chainId === 'base');
  } catch {
    return [];
  }
}

// ─── Gather token pairs (target ~100) ──────────────────────────────────────

async function gatherPairs(): Promise<any[]> {
  const promises = SEARCH_KEYWORDS.map((kw) => searchPairs(kw));
  const [boosted, ...searchResults] = await Promise.all([
    fetchBoostedTokens(),
    ...promises,
  ]);

  const map = new Map<string, any>();

  for (const b of boosted) {
    if (b.tokenAddress) {
      map.set(b.tokenAddress.toLowerCase(), { _boost: b, _source: 'boost' });
    }
  }

  for (const pairs of searchResults) {
    for (const p of pairs) {
      const addr = p.baseToken?.address?.toLowerCase();
      if (addr) {
        map.set(addr, p);
      }
    }
  }

  const result: any[] = [];
  for (const [addr, val] of map) {
    if (val._source === 'boost') {
      const boost = val._boost;
      const search = await searchPairs(boost.tokenAddress);
      const pair = search.find((p: any) => p.chainId === 'base');
      if (pair) {
        result.push(pair);
        continue;
      }
    }
    if (val.pairAddress) {
      result.push(val);
    }
  }

  result.sort(
    (a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0)
  );

  return result.slice(0, 100);
}

// ─── Fetch candles 1 jam ──────────────────────────────────────────────────

async function fetchCandles(pairAddress: string): Promise<Candle[] | null> {
  try {
    const url = `${CANDLES_API}/${pairAddress}?res=60`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const raw: any[] = data.pairs?.[0]?.candles || [];
    if (raw.length < 2) return null;
    return raw.map((c: any) => ({
      timestamp: c.timestamp,
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume),
    }));
  } catch {
    return null;
  }
}

// ─── CoinGecko fallback ATH ──────────────────────────────────────────────

async function coinGeckoATH(tokenAddress: string): Promise<number | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/base/contract/${tokenAddress}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.market_data?.ath?.usd ?? null;
  } catch {
    return null;
  }
}

// ─── Get ATH + drop % ────────────────────────────────────────────────────

async function getDropData(
  pairAddress: string,
  tokenAddress: string,
  currentPrice: number
): Promise<{ athPrice: number; dropPercent: number } | null> {
  const candles = await fetchCandles(pairAddress);

  if (candles && candles.length >= 2) {
    const ath = Math.max(...candles.map((c) => c.high));
    if (ath > 0 && currentPrice > 0) {
      const drop = ((1 - currentPrice / ath) * 100);
      return { athPrice: ath, dropPercent: Math.round(drop * 100) / 100 };
    }
  }

  const athPrice = await coinGeckoATH(tokenAddress);
  if (athPrice && athPrice > 0 && currentPrice > 0) {
    const drop = ((1 - currentPrice / athPrice) * 100);
    return { athPrice, dropPercent: Math.round(drop * 100) / 100 };
  }

  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function scanDippedTokens(): Promise<ScannedToken[]> {
  const pairs = await gatherPairs();
  athLog.info(`Dapat ${pairs.length} pasangan token dari DexScreener`);

  if (pairs.length === 0) return [];

  const valid = pairs
    .map((p: any) => ({
      address: (p.baseToken?.address || '').toLowerCase(),
      name: p.baseToken?.name || 'Unknown',
      symbol: p.baseToken?.symbol || '???',
      priceUsd: parseFloat(p.priceUsd || '0'),
      liquidityUsd: p.liquidity?.usd ?? 0,
      volume24h: p.volume?.h24 ?? 0,
      pairAddress: p.pairAddress || '',
    }))
    .filter((p) => p.address && p.pairAddress && p.priceUsd > 0);

  athLog.info(`${valid.length} token valid dengan harga > 0`);

  const results: ScannedToken[] = [];
  const batchSize = 25;

  for (let i = 0; i < valid.length; i += batchSize) {
    const batch = valid.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (p) => {
        const dropData = await getDropData(
          p.pairAddress,
          p.address,
          p.priceUsd
        );
        if (!dropData) return null;

        return {
          address: p.address,
          name: p.name,
          symbol: p.symbol,
          priceUsd: p.priceUsd,
          liquidityUsd: p.liquidityUsd,
          volume24h: p.volume24h,
          athPrice: dropData.athPrice,
          dropPercent: dropData.dropPercent,
          pairAddress: p.pairAddress,
        } satisfies ScannedToken;
      })
    );

    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  const dipped = results.filter(
    (r) => r.dropPercent >= 40 && r.dropPercent <= 50
  );

  dipped.sort((a, b) => b.dropPercent - a.dropPercent);

  athLog.info(
    `${results.length} token diproses, ${dipped.length} turun 40-50% dari ATH`
  );

  return dipped;
}

export default scanDippedTokens;
