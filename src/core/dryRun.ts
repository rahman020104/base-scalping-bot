// ============================================================
// Dry Run — Simulasi trade tanpa eksekusi nyata
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { Token, TradePosition, DryRunRecord } from '../types/index';
import { generateId, calculatePnL } from '../utils/helpers';
import { logger, createContextLogger } from '../utils/logger';

const dryLog = createContextLogger('dryrun');

const DRYRUN_FILE = path.join(process.cwd(), 'logs', 'dryrun.json');

// ─── Tipe summary ────────────────────────────────────────────────────────────

export interface DryRunSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  records: DryRunRecord[];
}

// ─── Read / write ────────────────────────────────────────────────────────────

function readRecords(): DryRunRecord[] {
  try {
    if (!fs.existsSync(DRYRUN_FILE)) return [];
    const raw = fs.readFileSync(DRYRUN_FILE, 'utf-8');
    return JSON.parse(raw) as DryRunRecord[];
  } catch (err) {
    dryLog.error('Gagal baca dryrun.json', { error: String(err) });
    return [];
  }
}

function writeRecords(records: DryRunRecord[]): void {
  try {
    const dir = path.dirname(DRYRUN_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DRYRUN_FILE, JSON.stringify(records, null, 2), 'utf-8');
  } catch (err) {
    dryLog.error('Gagal nulis dryrun.json', { error: String(err) });
  }
}

// ─── Simulasikan exit ────────────────────────────────────────────────────────

/**
 * Simulasi exit posisi.
 *
 * @param position Posisi yang mau di-exit
 * @param exitPrice Harga exit (bisa dari TP, SL, atau manual)
 * @param reason Alasan exit (TP/SL/manual)
 * @returns Record dry-run yang udah diupdate
 */
function simulateExit(
  position: TradePosition,
  exitPrice: number,
  reason: string
): DryRunRecord {
  const pnl = calculatePnL(position.entryPrice, exitPrice);
  const isWin = pnl >= 0;

  const record: DryRunRecord = {
    id: generateId(),
    timestamp: new Date(),
    token: {
      address: position.tokenAddress,
      name: position.tokenSymbol,
      symbol: position.tokenSymbol,
      pairSymbol: position.tokenSymbol,
      liquidityUsd: 0,
      volume24h: 0,
      ageHours: 0,
      priceUsd: exitPrice,
      decimals: 18,
    },
    indicators: [],
    signal: 'buy',
    trade: {
      ...position,
      status: isWin ? 'closed' : 'stopped',
      closedAt: new Date(),
      pnlPercent: pnl,
    },
    result: isWin ? 'win' : 'loss',
    pnlPercent: pnl,
    note: `Exit at $${exitPrice.toFixed(6)} — ${reason}. PnL: ${pnl.toFixed(2)}%`,
  };

  // Simpan ke file
  const records = readRecords();
  records.push(record);
  writeRecords(records);

  dryLog.info(
    `[DRY RUN] ${reason} ${position.tokenSymbol} | ` +
    `entry $${position.entryPrice} → exit $${exitPrice} | PnL ${pnl.toFixed(2)}%`
  );

  return record;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Catat trade simulasi (entry).
 *
 * @param position Posisi yang disimulasikan
 * @returns DryRunRecord yang baru dibuat
 */
export function recordEntry(position: TradePosition): DryRunRecord {
  const record: DryRunRecord = {
    id: generateId(),
    timestamp: new Date(),
    token: {
      address: position.tokenAddress,
      name: position.tokenSymbol,
      symbol: position.tokenSymbol,
      pairSymbol: position.tokenSymbol,
      liquidityUsd: 0,
      volume24h: 0,
      ageHours: 0,
      priceUsd: position.entryPrice,
      decimals: 18,
    },
    indicators: [],
    signal: 'buy',
    trade: position,
    result: 'open',
    pnlPercent: null,
    note: `Entry at $${position.entryPrice.toFixed(6)}. TP $${position.takeProfit.toFixed(6)}, SL $${position.stopLoss.toFixed(6)}`,
  };

  const records = readRecords();
  records.push(record);
  writeRecords(records);

  dryLog.info(
    `[DRY RUN] ENTRY ${position.tokenSymbol} @ $${position.entryPrice.toFixed(6)}`
  );

  return record;
}

/**
 * Simulasi TP (take profit) tercapai.
 */
export function recordTP(position: TradePosition): DryRunRecord {
  return simulateExit(position, position.takeProfit, 'TP');
}

/**
 * Simulasi SL (stop loss) tercapai.
 */
export function recordSL(position: TradePosition): DryRunRecord {
  return simulateExit(position, position.stopLoss, 'SL');
}

/**
 * Simulasi exit manual dengan harga tertentu.
 */
export function recordManualExit(position: TradePosition, exitPrice: number): DryRunRecord {
  return simulateExit(position, exitPrice, 'MANUAL');
}

/**
 * Dapatkan ringkasan semua dry-run trade.
 */
export function getDryRunSummary(): DryRunSummary {
  const records = readRecords();
  const closedRecords = records.filter((r) => r.result !== 'open');

  const wins = closedRecords.filter((r) => r.result === 'win').length;
  const losses = closedRecords.filter((r) => r.result === 'loss').length;
  const totalPnL = closedRecords.reduce(
    (sum, r) => sum + (r.pnlPercent ?? 0),
    0
  );

  return {
    totalTrades: records.length,
    wins,
    losses,
    winRate: closedRecords.length > 0
      ? Math.round((wins / closedRecords.length) * 10000) / 100
      : 0,
    totalPnL: Math.round(totalPnL * 100) / 100,
    avgPnL: closedRecords.length > 0
      ? Math.round((totalPnL / closedRecords.length) * 100) / 100
      : 0,
    records,
  };
}

/**
 * Dapatkan semua record yang masih open.
 */
export function getOpenRecords(): DryRunRecord[] {
  return readRecords().filter((r) => r.result === 'open');
}

/**
 * Bersihkan semua record dry-run.
 */
export function clearDryRun(): void {
  writeRecords([]);
  dryLog.info('Semua record dry-run dihapus');
}

export default {
  recordEntry,
  recordTP,
  recordSL,
  recordManualExit,
  getDryRunSummary,
  clearDryRun,
};
