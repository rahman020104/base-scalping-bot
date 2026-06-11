// ============================================================
// Scanner — Orkestasi alur utama scalping bot
// ============================================================
//
// Alur:
//   1. DISCOVER    → dexScanner: ambil token baru < 24 jam
//   2. FILTER      → honeypotDetector: buang scam
//   3. INDICATOR   → evaluateIndicators + isReadyToBuy
//   4. EXECUTE     → tradeManager.openPosition
//
// Jalankan tiap 15 menit otomatis via startScanLoop()
//
// ============================================================

import { CONFIG } from '../config/index';
import { logger, createContextLogger } from '../utils/logger';
import { discoverNewTokens } from '../services/dexScanner';
import { checkHoneypot } from '../services/honeypotDetector';
import { evaluateIndicators, isReadyToBuy } from '../services/indicators';
import { openPosition, canOpenPosition, getActivePositions } from './tradeManager';

const scanLog = createContextLogger('scanner');

// ─── State ───────────────────────────────────────────────────────────────────

let scanIntervalId: ReturnType<typeof setInterval> | null = null;
let isScanning = false;

// ─── Satu siklus scan ────────────────────────────────────────────────────────

/**
 * Jalankan satu siklus scan lengkap:
 * Discover → Honeypot check → Indicators → Buy decision
 */
export async function runCycle(): Promise<void> {
  if (isScanning) {
    scanLog.warn('Scan masih berjalan, skip siklus ini');
    return;
  }

  isScanning = true;
  const startTime = Date.now();
  scanLog.info('=== SCAN CYCLE START ===');

  try {
    // ── 1. Cek kapasitas ─────────────────────────────────────────────────
    if (!canOpenPosition()) {
      scanLog.info('Skip: 2 posisi sudah aktif');
      return;
    }

    const slotTersedia = 2 - getActivePositions().length;
    scanLog.info(`Slot tersedia: ${slotTersedia}`);

    // ── 2. DISCOVER — ambil token baru ──────────────────────────────────
    scanLog.info('🔍 Discovering new tokens...');
    const tokens = await discoverNewTokens();
    scanLog.info(`Ditemukan ${tokens.length} token qualified`);

    if (tokens.length === 0) {
      scanLog.info('Tidak ada token baru untuk dicek');
      return;
    }

    // ── 3. Filter & beli ────────────────────────────────────────────────
    let bought = 0;

    for (const token of tokens) {
      if (!canOpenPosition()) {
        scanLog.info(`Berhenti: posisi penuh (${getActivePositions().length}/2)`);
        break;
      }

      // ── 3a. HONEYPOT CHECK ─────────────────────────────────────────
      scanLog.info(`🛡️  Check honeypot: ${token.symbol} (${token.address})`);
      const hp = await checkHoneypot(token.address);

      if (hp.isHoneypot) {
        scanLog.warn(`  ❌ HONEYPOT: ${token.symbol} — ${hp.reason}`);
        continue;
      }

      scanLog.info(`  ✅ Aman: buyTax=${hp.buyTax}%, sellTax=${hp.sellTax}%`);

      // ── 3b. INDICATORS ─────────────────────────────────────────────
      scanLog.info(`📊 Evaluate indicators: ${token.symbol}`);
      const indicators = await evaluateIndicators(token);

      if (!isReadyToBuy(indicators)) {
        const hijau = indicators.filter((i) => i.hijau).length;
        scanLog.info(`  ❌ Skip: hanya ${hijau}/5 indikator hijau`);
        continue;
      }

      scanLog.info(`  ✅ Sinyal beli: ${indicators.filter((i) => i.hijau).length}/5 hijau`);

      // ── 3c. EXECUTE ────────────────────────────────────────────────
      scanLog.info(`💰 BUY SIGNAL: ${token.symbol} @ $${token.priceUsd}`);
      const position = await openPosition(token, indicators);

      if (position) {
        bought++;
        scanLog.info(
          `  ✅ POSISI DIBUKA: ${token.symbol} | ` +
          `entry $${token.priceUsd} | TP $${position.takeProfit} | SL $${position.stopLoss}`
        );
      } else {
        scanLog.warn(`  ❌ Gagal buka posisi: ${token.symbol}`);
      }
    }

    // ── Ringkasan ────────────────────────────────────────────────────────
    const duration = Date.now() - startTime;
    scanLog.info(
      `=== SCAN CYCLE DONE (${duration}ms) === ` +
      `Token dicek: ${tokens.length}, Posisi dibuka: ${bought}, ` +
      `Aktif: ${getActivePositions().length}/2`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    scanLog.error(`Scan cycle error: ${msg}`);
  } finally {
    isScanning = false;
  }
}

// ─── Loop otomatis ───────────────────────────────────────────────────────────

/**
 * Mulai scan loop tiap 15 menit.
 * Langsung jalan sekali di awal.
 */
export function startScanLoop(): void {
  if (scanIntervalId) {
    scanLog.warn('Scan loop sudah berjalan');
    return;
  }

  scanLog.info(`Mulai scan loop tiap ${CONFIG.minLiquidityUsd ? '15' : '15'} menit`);

  // Jalan langsung sekali
  runCycle();

  // Terus tiap 15 menit
  scanIntervalId = setInterval(() => {
    runCycle();
  }, 15 * 60 * 1000);
}

/**
 * Hentikan scan loop.
 */
export function stopScanLoop(): void {
  if (scanIntervalId) {
    clearInterval(scanIntervalId);
    scanIntervalId = null;
    scanLog.info('Scan loop dihentikan');
  }
}

export default {
  runCycle,
  startScanLoop,
  stopScanLoop,
};
