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

// ─── CLI output helper ───────────────────────────────────────────────────────
// Log ke console (biar user liat) + file (buat debugging)

function cli(msg: string): void {
  console.log(`  ${msg}`);
  scanLog.info(msg.replace(/\x1b\[[0-9;]*m/g, '')); // strip ANSI for file log
}

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
  cli('=== SCAN CYCLE START ===');

  try {
    // ── 1. Cek kapasitas ─────────────────────────────────────────────────
    if (!canOpenPosition()) {
      cli(`Skip: ${CONFIG.maxPositions} posisi sudah aktif`);
      return;
    }

    const slotTersedia = CONFIG.maxPositions - getActivePositions().length;
    cli(`Slot tersedia: ${slotTersedia}`);

    // ── 2. DISCOVER — ambil token baru ──────────────────────────────────
    cli('🔍 Discovering new tokens...');
    const tokens = await discoverNewTokens();
cli(`Ditemukan ${tokens.length} token qualified`);

    if (tokens.length === 0) {
      cli('Tidak ada token baru untuk dicek');
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
      cli(`🛡️  Check honeypot: ${token.symbol}`);
      const hp = await checkHoneypot(token.address);

      if (hp.isHoneypot) {
        cli(`  ❌ HONEYPOT: ${token.symbol} — ${hp.reason}`);
        continue;
      }

      cli(`  ✅ Aman: buyTax=${hp.buyTax}%, sellTax=${hp.sellTax}%`);

      // ── 3b. INDICATORS ─────────────────────────────────────────────
      cli(`📊 Evaluate indicators: ${token.symbol}`);
      const indicators = await evaluateIndicators(token);

      if (!isReadyToBuy(indicators)) {
        const hijau = indicators.filter((i) => i.hijau).length;
        cli(`  ❌ Skip: hanya ${hijau}/6 indikator hijau`);
        continue;
      }

      cli(`  ✅ Sinyal beli: ${indicators.filter((i) => i.hijau).length}/6 hijau`);

      // ── 3c. EXECUTE ────────────────────────────────────────────────
      cli(`💰 BUY SIGNAL: ${token.symbol} @ $${token.priceUsd}`);
      const position = await openPosition(token, indicators);

      if (position) {
        bought++;
        cli(`  ✅ POSISI DIBUKA: ${token.symbol} | entry $${token.priceUsd} | TP $${position.takeProfit} | SL $${position.stopLoss}`);
      } else {
        cli(`  ❌ Gagal buka posisi: ${token.symbol}`);
      }
    }

    // ── Ringkasan ────────────────────────────────────────────────────────
    const duration = Date.now() - startTime;
    cli(`=== SCAN CYCLE DONE (${duration}ms) ===`);

    // ── Tabel posisi aktif ────────────────────────────────────────────────
    const positions = getActivePositions();
    if (positions.length > 0) {
      const header = `  ${'Token'.padEnd(10)} ${'Entry $'.padStart(10)} ${'TP $'.padStart(10)} ${'SL $'.padStart(10)} ${'Status'.padStart(8)}`;
      const sep = `  ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(8)}`;
      console.log(`  ${sep}`);
      console.log(`  ${header}`);
      console.log(`  ${sep}`);
      for (const p of positions) {
        console.log(
          `  ${p.tokenSymbol.padEnd(10)} ` +
          `${p.entryPrice.toFixed(4).padStart(10)} ` +
          `${p.takeProfit.toFixed(4).padStart(10)} ` +
          `${p.stopLoss.toFixed(4).padStart(10)} ` +
          `${p.status.padStart(8)}`
        );
      }
      console.log(`  ${sep}`);
      console.log(`  Total: ${positions.length}/${CONFIG.maxPositions} posisi | ${bought} baru dibuka`);
    } else {
      console.log(`  Tidak ada posisi aktif.`);
    }
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

  scanLog.info(`Mulai scan loop tiap ${CONFIG.scanIntervalMinutes} menit`);

  // Jalan langsung sekali
  runCycle();

  // Terus tiap ${CONFIG.scanIntervalMinutes} menit
  scanIntervalId = setInterval(() => {
    runCycle();
  }, CONFIG.scanIntervalMinutes * 60 * 1000);
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
