import { Token } from '../types/index';
import { createContextLogger } from '../utils/logger';
import { scanDippedTokens } from '../services/athScanner';
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
    // ── Phase 1: DISCOVER ────────────────────────────────────────────────
    wmLog.info('Phase 1: scan koin turun 40-50% dari ATH');
    const dipped = await scanDippedTokens();
    wmLog.info(`Ditemukan ${dipped.length} koin turun 40-50%`);

    for (const d of dipped) {
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

    // ── Phase 2: EVALUATE ────────────────────────────────────────────────
    const watchlist = await getWatchlist();
    wmLog.info(`Phase 2: evaluasi ${watchlist.length} item di watchlist`);

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
      const hijau = indicators.filter((i) => i.hijau).length;

      if (!isReadyToBuy(indicators)) {
        wmLog.info(`❌ Skip ${fresh.symbol}: ${hijau}/4 hijau`);
        continue;
      }

      wmLog.info(`✅ Sinyal beli ${fresh.symbol}: ${hijau}/4 hijau`);
      const pos = await openPosition(fresh, indicators);
      if (pos) {
        bought++;
        wmLog.info(`✅ BUY ${fresh.symbol} @ $${fresh.priceUsd}`);
        await removeFromWatchlist(fresh.address);
        wmLog.info(`${fresh.symbol} dihapus dari watchlist`);
      }
    }

    const dur = Date.now() - startTime;
    wmLog.info(`=== WATCHLIST CYCLE DONE (${dur}ms, ${bought} posisi baru) ===`);
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
