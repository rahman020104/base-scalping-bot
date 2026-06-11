// ============================================================
// Trade Manager — Atur posisi, TP, SL, maks 2 posisi
// ============================================================

import { Token, TradePosition, DryRunRecord, IndicatorResult } from '../types/index';
import { CONFIG } from '../config/index';
import { generateId, calculatePnL } from '../utils/helpers';
import { logger, createContextLogger } from '../utils/logger';
import { startMonitoring, checkPosition } from '../services/monitor';
import { evaluateIndicators, isReadyToBuy } from '../services/indicators';
import { recordEntry, recordTP, recordSL, recordManualExit, getDryRunSummary } from './dryRun';

const mgrLog = createContextLogger('trademanager');

// ─── State ───────────────────────────────────────────────────────────────────

/** Daftar posisi aktif (max 2) */
const activePositions: Map<string, TradePosition> = new Map();

/** Fungsi stop monitoring per posisi */
const stopMonitors: Map<string, () => void> = new Map();

// ─── Hitung TP/SL ────────────────────────────────────────────────────────────

function calculateTakeProfit(entryPrice: number): number {
  // TP: +150% dari entry
  return entryPrice * 2.5;
}

function calculateStopLoss(entryPrice: number): number {
  // SL: -30% dari entry
  return entryPrice * 0.7;
}

// ─── Buka posisi ─────────────────────────────────────────────────────────────

/**
 * Buka posisi baru untuk token.
 *
 * - Cek indikator dulu (min 3/5 hijau)
 * - Kalo posisi udah 2, tolak
 * - Hitung TP (+150%) dan SL (-30%)
 * - Catat ke dry-run
 * - Mulai monitoring harga tiap 30 detik
 *
 * @param token Token yang mau dibeli
 * @param indicators Hasil indikator (optional, kalo mau pake yg sudah dihitung)
 * @returns TradePosition kalo berhasil, null kalo ditolak
 */
export async function openPosition(
  token: Token,
  indicators?: IndicatorResult[]
): Promise<TradePosition | null> {
  // ── Cek limit posisi ────────────────────────────────────────────────────
  if (activePositions.size >= 2) {
    mgrLog.warn(`Tolak ${token.symbol}: sudah 2 posisi aktif`);
    return null;
  }

  // ── Cek indikator ───────────────────────────────────────────────────────
  const inds = indicators ?? await evaluateIndicators(token);
  if (!isReadyToBuy(inds)) {
    mgrLog.info(`Tolak ${token.symbol}: indikator belum cukup (${inds.filter(i => i.hijau).length}/5)`);
    return null;
  }

  // ── Hitung TP/SL ────────────────────────────────────────────────────────
  const entryPrice = token.priceUsd;
  const takeProfit = calculateTakeProfit(entryPrice);
  const stopLoss = calculateStopLoss(entryPrice);

  // ── Buat posisi ─────────────────────────────────────────────────────────
  const position: TradePosition = {
    tokenAddress: token.address,
    tokenSymbol: token.symbol,
    entryPrice,
    amountInEth: CONFIG.tradeAmountUsd.toString(),
    amountOut: '0',
    takeProfit,
    stopLoss,
    status: 'open',
    openedAt: new Date(),
    closedAt: null,
    pnlPercent: null,
  };

  // ── Simpan ──────────────────────────────────────────────────────────────
  activePositions.set(token.address, position);

  // ── Catat ke dry-run ────────────────────────────────────────────────────
  recordEntry(position);

  mgrLog.info(
    `✅ BUY ${token.symbol} @ $${entryPrice.toFixed(6)} | ` +
    `TP $${takeProfit.toFixed(6)} | SL $${stopLoss.toFixed(6)}`
  );

  // ── Mulai monitoring ────────────────────────────────────────────────────
  const stopMonitor = startMonitoring(position, (result) => {
    mgrLog.info(`Monitor ${token.symbol}: ${result.status} | PnL ${result.pnlPercent.toFixed(2)}%`);

    // Kalo kena TP/SL, catat ke dry-run dan hapus dari aktif
    if (result.status === 'TP_HIT') {
      recordTP(position);
      activePositions.delete(position.tokenAddress);
      stopMonitors.delete(position.tokenAddress);
    } else if (result.status === 'SL_HIT') {
      recordSL(position);
      activePositions.delete(position.tokenAddress);
      stopMonitors.delete(position.tokenAddress);
    }
  });

  stopMonitors.set(token.address, stopMonitor);

  return position;
}

// ─── Tutup posisi manual ─────────────────────────────────────────────────────

/**
 * Tutup posisi secara manual.
 *
 * @param tokenAddress Address token
 * @param reason Alasan penutupan
 * @param exitPrice Harga exit (optional — kalo dikosongin pake harga saat ini)
 * @returns DryRunRecord kalo berhasil, null kalo posisi gak ditemukan
 */
export async function closePosition(
  tokenAddress: string,
  reason: string,
  exitPrice?: number
): Promise<DryRunRecord | null> {
  const position = activePositions.get(tokenAddress);
  if (!position) {
    mgrLog.warn(`Posisi ${tokenAddress} tidak ditemukan`);
    return null;
  }

  // Hentikan monitoring
  const stop = stopMonitors.get(tokenAddress);
  if (stop) {
    stop();
    stopMonitors.delete(tokenAddress);
  }

  // Dapatkan harga exit
  let finalExitPrice = exitPrice;
  if (finalExitPrice === undefined) {
    // Cek harga saat ini via monitor
    const result = await checkPosition(position);
    finalExitPrice = result.currentPrice > 0 ? result.currentPrice : position.entryPrice;
  }

  // Update posisi
  const pnl = calculatePnL(position.entryPrice, finalExitPrice);
  position.status = pnl >= 0 ? 'closed' : 'stopped';
  position.closedAt = new Date();
  position.pnlPercent = pnl;

  // Hapus dari aktif
  activePositions.delete(tokenAddress);

  // Catat ke dry-run
  const record = recordManualExit(position, finalExitPrice);

  mgrLog.info(
    `🔚 CLOSE ${position.tokenSymbol} | exit $${finalExitPrice.toFixed(6)} | ` +
    `PnL ${pnl.toFixed(2)}% | alasan: ${reason}`
  );

  return record;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Dapatkan daftar posisi aktif.
 */
export function getActivePositions(): TradePosition[] {
  return Array.from(activePositions.values());
}

/**
 * Cek apakah masih bisa buka posisi baru.
 */
export function canOpenPosition(): boolean {
  return activePositions.size < 2;
}

/**
 * Hitung total investasi aktif (dalam USD).
 */
export function getTotalInvested(): number {
  let total = 0;
  for (const pos of activePositions.values()) {
    total += parseFloat(pos.amountInEth);
  }
  return total;
}

export default {
  openPosition,
  closePosition,
  getActivePositions,
  canOpenPosition,
  getTotalInvested,
};
