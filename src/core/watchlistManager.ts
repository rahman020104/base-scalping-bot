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

let loopId: ReturnType<typeof setInterval> | null = null;
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

// ─── Core cycle ─────────────────────────────────────────────────────────────

export async function runWatchlistCycle(): Promise<void> {
  if (isRunning) {
    wmLog.warn('Cycle masih berjalan, skip');
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  wmLog.info('=== WATCHLIST CYCLE START ===');

  try {
    // =====================================================================
    // === DISCOVERY ===
    // =====================================================================
    wmLog.info('DISCOVERY: scan koin turun 40-50% dari ATH');
    const dipped = await scanDippedTokens();
    wmLog.info(`Ditemukan ${dipped.length} koin turun 40-50%`);

    // =====================================================================
    // === FILTER ===
    // =====================================================================
    let lolosFilter = 0;
    let gagalHoneypot = 0;
    let gagalLikuiditas = 0;
    let gagalVolume = 0;
    let gagalHistory = 0;

    for (const d of dipped) {
      let alasan: string | null = null;

      // 1. Honeypot check
      const hp = await checkHoneypot(d.address);
      if (hp.isHoneypot) {
        gagalHoneypot++;
        wmLog.info(`FILTER ❌ ${d.symbol}: honeypot — ${hp.reason}`);
        continue;
      }

      // 2. Liquidity > MIN_LIQUIDITY_USD
      if (d.liquidityUsd < CONFIG.minLiquidityUsd) {
        gagalLikuiditas++;
        wmLog.info(`FILTER ❌ ${d.symbol}: likuiditas $${d.liquidityUsd} < $${CONFIG.minLiquidityUsd}`);
        continue;
      }

      // 3. Volume 24h > MIN_VOLUME_24H
      if (d.volume24h < CONFIG.minVolume24hUsd) {
        gagalVolume++;
        wmLog.info(`FILTER ❌ ${d.symbol}: volume $${d.volume24h} < $${CONFIG.minVolume24hUsd}`);
        continue;
      }

      // 4. Minimal 48 candle 1 jam
      const candleCount = await getCandleCount(d.pairAddress);
      if (candleCount < 48) {
        gagalHistory++;
        wmLog.info(`FILTER ❌ ${d.symbol}: hanya ${candleCount} candle (min 48)`);
        continue;
      }

      // Lolos semua filter
      lolosFilter++;
      wmLog.info(`FILTER ✅ ${d.symbol}: honeypot aman, likuiditas $${d.liquidityUsd}, volume $${d.volume24h}, ${candleCount} candle`);

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
    }

    wmLog.info(
      `FILTER: ${lolosFilter} lolos, ${gagalHoneypot} honeypot, ${gagalLikuiditas} likuiditas, ${gagalVolume} volume, ${gagalHistory} history`
    );

    // =====================================================================
    // === MONITOR ===
    // =====================================================================
    const watchlist = await getWatchlist();
    wmLog.info(`MONITOR: ${watchlist.length} item di watchlist`);

    let bought = 0;

    for (const item of watchlist) {
      if (!canOpenPosition()) {
        wmLog.info(`Posisi penuh (${getActivePositions().length}), stop`);
        break;
      }

      const fresh = await fetchFreshToken(item.token.address);
      if (!fresh || fresh.priceUsd <= 0) {
        wmLog.warn(`${item.token.symbol}: gagal fetch harga, skip`);
        continue;
      }

      const indicators = await evaluateIndicators(fresh);
      const htf = indicators.find((i) => i.name === 'htfSignal');
      const ltf = indicators.find((i) => i.name === 'ltfConfirm');

      wmLog.info(
        `${item.token.symbol}: HTF=${htf?.hijau ? '✅' : '❌'} LTF=${ltf?.hijau ? '✅' : '❌'}`
      );

      // ===================================================================
      // === ENTRY ===
      // ===================================================================
      if (!isReadyToBuy(indicators)) {
        continue;
      }

      wmLog.info(`ENTRY ✅ ${fresh.symbol}: HTF + LTF confirmed`);
      const pos = await openPosition(fresh, indicators);
      if (pos) {
        bought++;
        wmLog.info(`ENTRY ✅ BUY ${fresh.symbol} @ $${fresh.priceUsd}`);
        await removeFromWatchlist(fresh.address);
        wmLog.info(`${fresh.symbol} dihapus dari watchlist`);
      }
    }

    const dur = Date.now() - startTime;
    wmLog.info(
      `=== WATCHLIST CYCLE DONE (${dur}ms, ${lolosFilter} watchlist, ${bought} entry) ===`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    wmLog.error(`Watchlist cycle error: ${msg}`);
  } finally {
    isRunning = false;
  }
}

// ─── Loop otomatis tiap 1 jam ──────────────────────────────────────────────

export function startWatchlistLoop(): void {
  if (loopId) {
    wmLog.warn('Watchlist loop sudah berjalan');
    return;
  }

  wmLog.info('Mulai watchlist loop tiap 1 jam');
  runWatchlistCycle();
  loopId = setInterval(runWatchlistCycle, 60 * 60 * 1000);
}

export function stopWatchlistLoop(): void {
  if (loopId) {
    clearInterval(loopId);
    loopId = null;
    wmLog.info('Watchlist loop dihentikan');
  }
}

export default { runWatchlistCycle, startWatchlistLoop, stopWatchlistLoop };
