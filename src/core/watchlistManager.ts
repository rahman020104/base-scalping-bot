import { Token } from '../types/index';
import { CONFIG } from '../config/index';
import { createContextLogger } from '../utils/logger';
import { scanDippedTokens } from '../services/athScanner';
import { checkHoneypot } from '../services/honeypotDetector';
import {
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
} from '../services/watchlist';
import { evaluateIndicators, isReadyToBuy } from '../services/indicators';
import {
  openPosition,
  canOpenPosition,
  getActivePositions,
} from './tradeManager';

const wmLog = createContextLogger('watchlistMgr');

function cli(msg: string): void {
  console.log(`  ${msg}`);
  wmLog.info(msg.replace(/\x1b\[[0-9;]*m/g, ''));
}

let discoveryId: ReturnType<typeof setInterval> | null = null;
let entryId: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// ─── Fresh price dari DexScreener ───────────────────────────────────────────

async function fetchFreshToken(address: string): Promise<Token | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const pair = (data.pairs || []).find((p: any) => p.chainId === 'base');
    if (!pair) return null;

    return {
      address: pair.baseToken.address.toLowerCase(),
      name: pair.baseToken.name || 'Unknown',
      symbol: pair.baseToken.symbol || '???',
      pairSymbol: `${pair.baseToken.symbol || '?'}/${pair.quoteToken?.symbol || '?'}`,
      liquidityUsd: pair.liquidity?.usd ?? 0,
      volume24h: pair.volume?.h24 ?? 0,
      ageHours: pair.pairCreatedAt
        ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60)
        : 0,
      priceUsd: parseFloat(pair.priceUsd || '0'),
      decimals: 18,
    };
  } catch {
    return null;
  }
}

// ─── Hitung jumlah candle 1 jam tersedia ────────────────────────────────────

async function getCandleCount(pairAddress: string): Promise<number> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/candles/base/${pairAddress}?res=60`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return 0;
    const data: any = await res.json();
    const raw: any[] = data.pairs?.[0]?.candles || [];
    return raw.length;
  } catch {
    return 0;
  }
}

// ─── Discovery cycle (tiap 1 jam) ──────────────────────────────────────────

export async function runWatchlistCycle(): Promise<void> {
  if (isRunning) {
    wmLog.warn('Discovery masih berjalan, skip');
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  cli('=== DISCOVERY CYCLE ===');

  try {
    // =====================================================================
    // === DISCOVERY ===
    // =====================================================================
    const dipped = await scanDippedTokens();
    cli(`Ditemukan ${dipped.length} koin turun 40-50%`);

    // =====================================================================
    // === FILTER ===
    // =====================================================================
    let lolosFilter = 0;
    let gagalHoneypot = 0;
    let gagalLikuiditas = 0;
    let gagalVolume = 0;

    for (const d of dipped) {

      // 1. Honeypot check
      const hp = await checkHoneypot(d.address);
      if (hp.isHoneypot) {
        gagalHoneypot++;
        cli(`FILTER ❌ ${d.symbol}: honeypot — ${hp.reason}`);
        continue;
      }

      // 2. Liquidity > MIN_LIQUIDITY_USD
      if (d.liquidityUsd < CONFIG.minLiquidityUsd) {
        gagalLikuiditas++;
        cli(`FILTER ❌ ${d.symbol}: likuiditas $${d.liquidityUsd} < $${CONFIG.minLiquidityUsd}`);
        continue;
      }

      // 3. Volume 24h > MIN_VOLUME_24H
      if (d.volume24h < CONFIG.minVolume24hUsd) {
        gagalVolume++;
        cli(`FILTER ❌ ${d.symbol}: volume $${d.volume24h} < $${CONFIG.minVolume24hUsd}`);
        continue;
      }

      // Lolos semua filter
      lolosFilter++;

      // ===================================================================
      // === WATCHLIST ===
      // ===================================================================
      const token: Token = {
        address: d.address,
        name: d.name,
        symbol: d.symbol,
        pairSymbol: '??/WETH',
        liquidityUsd: d.liquidityUsd,
        volume24h: d.volume24h,
        ageHours: 0,
        priceUsd: d.priceUsd,
        decimals: 18,
      };
      await addToWatchlist(token, d.athPrice, d.pairAddress);
      cli(`WATCHLIST ✅ ${d.symbol}: ditambahkan (likuiditas $${d.liquidityUsd}, volume $${d.volume24h})`);
    }

    cli(`DISCOVERY DONE: ${lolosFilter} watchlist baru, ${gagalHoneypot} honeypot, ${gagalLikuiditas} likuiditas, ${gagalVolume} volume`);

    const dur = Date.now() - startTime;
    cli(`=== DISCOVERY DONE (${dur}ms) ===`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    wmLog.error(`Discovery cycle error: ${msg}`);
  } finally {
    isRunning = false;
  }
}

// ─── Entry check (tiap 2 menit) ────────────────────────────────────────────

export async function runEntryCheck(): Promise<void> {
  try {
    const watchlist = await getWatchlist();
    if (watchlist.length === 0) return;

    for (const item of watchlist) {
      if (!canOpenPosition()) break;

      const fresh = await fetchFreshToken(item.token.address);
      if (!fresh || fresh.priceUsd <= 0) continue;

      const indicators = await evaluateIndicators(fresh);
      const htf = indicators.find((i) => i.name === 'htfSignal');
      const ltf = indicators.find((i) => i.name === 'ltfConfirm');

      if (!isReadyToBuy(indicators)) continue;

      cli(`ENTRY ✅ ${fresh.symbol}: HTF=${htf?.hijau} LTF=${ltf?.hijau} @ $${fresh.priceUsd}`);
      const pos = await openPosition(fresh, indicators);
      if (pos) {
        cli(`ENTRY ✅ BUY ${fresh.symbol} @ $${fresh.priceUsd}`);
        await removeFromWatchlist(fresh.address);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    wmLog.error(`Entry check error: ${msg}`);
  }
}

// ─── Loop otomatis ─────────────────────────────────────────────────────────

export function startWatchlistLoop(): void {
  if (discoveryId) {
    wmLog.warn('Watchlist loop sudah berjalan');
    return;
  }

  wmLog.info('Mulai discovery tiap 1 jam + entry check tiap 2 menit');

  // DISCOVERY: scan + filter + watchlist tiap 1 jam
  runWatchlistCycle();
  discoveryId = setInterval(runWatchlistCycle, 60 * 60 * 1000);

  // ENTRY: cek sinyal tiap 5 menit (tunggu close candle M5)
  entryId = setInterval(runEntryCheck, 5 * 60 * 1000);
}

export function stopWatchlistLoop(): void {
  if (discoveryId) {
    clearInterval(discoveryId);
    discoveryId = null;
  }
  if (entryId) {
    clearInterval(entryId);
    entryId = null;
  }
  wmLog.info('Watchlist loop dihentikan');
}

export default { runWatchlistCycle, startWatchlistLoop, stopWatchlistLoop };
