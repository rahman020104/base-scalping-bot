// ============================================================
// Monitor — Pantau harga posisi aktif tiap 30 detik
// ============================================================

import { TradePosition } from '../types/index';
import { validateAddress } from '../utils/helpers';
import { logger, createContextLogger } from '../utils/logger';
import { sellToken } from './executor';

const monLog = createContextLogger('monitor');

// ─── Tipe status ─────────────────────────────────────────────────────────────

export type PositionStatus = 'OPEN' | 'CLOSED' | 'TP_HIT' | 'SL_HIT' | 'ERROR';

export interface MonitorResult {
  status: PositionStatus;
  currentPrice: number;
  pnlPercent: number;
  message: string;
}

// ─── Fetch harga dari DexScreener ────────────────────────────────────────────

async function fetchPrice(tokenAddress: string): Promise<number | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(tokenAddress)}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const data: any = await res.json();
    const pairs: any[] = data.pairs || [];
    const basePair = pairs.find((p: any) => p.chainId === 'base');

    if (!basePair?.priceUsd) return null;

    return parseFloat(basePair.priceUsd);
  } catch {
    return null;
  }
}

// ─── Hitung PnL ─────────────────────────────────────────────────────────────

function calculatePnl(entry: number, current: number): number {
  if (entry <= 0) return 0;
  return ((current - entry) / entry) * 100;
}

// ─── Monitor satu posisi ─────────────────────────────────────────────────────

/**
 * Cek harga token dan bandingkan dengan TP/SL.
 *
 * - Harga > TP → panggil executor.sellToken() (ambil profit)
 * - Harga < SL → panggil executor.sellToken() (cut loss)
 * - Harga di antara → return OPEN
 *
 * @param position Posisi aktif yang mau dipantau
 * @returns MonitorResult — status, harga, PnL
 */
export async function checkPosition(position: TradePosition): Promise<MonitorResult> {
  // ── Validasi ────────────────────────────────────────────────────────────
  if (!validateAddress(position.tokenAddress)) {
    return {
      status: 'ERROR',
      currentPrice: 0,
      pnlPercent: 0,
      message: `Invalid address: ${position.tokenAddress}`,
    };
  }

  if (position.status !== 'open') {
    return {
      status: 'CLOSED',
      currentPrice: 0,
      pnlPercent: position.pnlPercent ?? 0,
      message: `Position already ${position.status}`,
    };
  }

  // ── Fetch harga ─────────────────────────────────────────────────────────
  const currentPrice = await fetchPrice(position.tokenAddress);
  if (currentPrice === null) {
    monLog.warn(`Gagal fetch harga ${position.tokenSymbol}`);
    return {
      status: 'OPEN',
      currentPrice: 0,
      pnlPercent: 0,
      message: `Price fetch failed for ${position.tokenSymbol}`,
    };
  }

  const pnl = calculatePnl(position.entryPrice, currentPrice);

  // ── Cek TP ──────────────────────────────────────────────────────────────
  if (currentPrice >= position.takeProfit) {
    monLog.info(
      `🎯 TP HIT! ${position.tokenSymbol} | ` +
      `harga ${currentPrice} >= TP ${position.takeProfit} | PnL ${pnl.toFixed(2)}%`
    );

    try {
      const result = await sellToken(position.tokenAddress, position.amountOut);
      monLog.info(`Sell executed: ${result.txHash || 'dry-run'}`);

      return {
        status: 'TP_HIT',
        currentPrice,
        pnlPercent: pnl,
        message: `TP hit at $${currentPrice}. Sold ${position.amountOut} tokens. Tx: ${result.txHash || 'dry-run'}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      monLog.error(`Gagal sell saat TP: ${msg}`);
      return {
        status: 'ERROR',
        currentPrice,
        pnlPercent: pnl,
        message: `TP triggered but sell failed: ${msg}`,
      };
    }
  }

  // ── Cek SL ──────────────────────────────────────────────────────────────
  if (currentPrice <= position.stopLoss) {
    monLog.warn(
      `🛑 SL HIT! ${position.tokenSymbol} | ` +
      `harga ${currentPrice} <= SL ${position.stopLoss} | PnL ${pnl.toFixed(2)}%`
    );

    try {
      const result = await sellToken(position.tokenAddress, position.amountOut);
      monLog.info(`Sell executed: ${result.txHash || 'dry-run'}`);

      return {
        status: 'SL_HIT',
        currentPrice,
        pnlPercent: pnl,
        message: `SL hit at $${currentPrice}. Sold ${position.amountOut} tokens. Tx: ${result.txHash || 'dry-run'}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      monLog.error(`Gagal sell saat SL: ${msg}`);
      return {
        status: 'ERROR',
        currentPrice,
        pnlPercent: pnl,
        message: `SL triggered but sell failed: ${msg}`,
      };
    }
  }

  // ── Masih aman ──────────────────────────────────────────────────────────
  return {
    status: 'OPEN',
    currentPrice,
    pnlPercent: pnl,
    message: `${position.tokenSymbol} | $${currentPrice.toFixed(6)} | PnL ${pnl.toFixed(2)}%`,
  };
}

// ─── Monitor loop ────────────────────────────────────────────────────────────

export type PriceCallback = (result: MonitorResult) => void;

/**
 * Pantau harga token tiap 30 detik sampai posisi ditutup.
 * Setiap ada update, callback dipanggil dengan status terbaru.
 *
 * @param position Posisi aktif
 * @param callback Dipanggil tiap kali selesai cek harga
 * @returns Fungsi buat stop monitoring (clear interval)
 */
export function startMonitoring(
  position: TradePosition,
  callback: PriceCallback
): () => void {
  monLog.info(`Mulai monitoring ${position.tokenSymbol} tiap 30 detik`);

  // Cek langsung sekali
  checkPosition(position).then(callback);

  // Interval tiap 30 detik
  const intervalId = setInterval(async () => {
    try {
      const result = await checkPosition(position);
      callback(result);

      // Kalo kena TP/SL, stop monitoring
      if (result.status === 'TP_HIT' || result.status === 'SL_HIT' || result.status === 'ERROR') {
        clearInterval(intervalId);
        monLog.info(`Monitoring ${position.tokenSymbol} dihentikan: ${result.status}`);
      }
    } catch (err) {
      monLog.error(`Error monitoring ${position.tokenSymbol}: ${String(err)}`);
    }
  }, 30_000);

  // Return fungsi buat stop manual
  return () => {
    clearInterval(intervalId);
    monLog.info(`Monitoring ${position.tokenSymbol} dihentikan manual`);
  };
}

export default { checkPosition, startMonitoring };
