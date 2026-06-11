// ============================================================
// Index — CLI Entry Point
// ============================================================
//
// Usage:
//   npm run trade    → jalankan scanner mode LIVE/DRY
//   npm run dry      → paksa DRY_RUN=true
//   npm run summary  → tampilkan hasil dry-run
//
// ============================================================

import { CONFIG } from './config/index';
import { logger } from './utils/logger';
import { runCycle, startScanLoop, stopScanLoop } from './core/scanner';
import { getDryRunSummary, clearDryRun } from './core/dryRun';

// ─── Banner ──────────────────────────────────────────────────────────────────

function showBanner(): void {
  const mode = CONFIG.dryRun ? 'DRY RUN' : '🔴 LIVE';
  const modeColor = CONFIG.dryRun ? '\x1b[33m' : '\x1b[31m'; // yellow / red

  console.log('');
  console.log(`╔══════════════════════════════════════════╗`);
  console.log(`║        Base Scalping Bot v1.0           ║`);
  console.log(`║  ${modeColor}${mode}\x1b[0m                    ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  Chain:  Base (8453)                    ║`);
  console.log(`║  Modal:  $200                          ║`);
  console.log(`║  Trade:  $${CONFIG.tradeAmountUsd}/pos                    ║`);
  console.log(`║  Max:    2 posisi                      ║`);
  console.log(`║  TP:     +150% | SL: -30%              ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log('');
}

// ─── Command: trade ──────────────────────────────────────────────────────────

async function cmdTrade(): Promise<void> {
  showBanner();
  logger.info(`Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
  logger.info(`Memulai scanner...`);

  // Jalan sekali
  await runCycle();

  // Loop tiap 15 menit
  startScanLoop();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    stopScanLoop();
    logger.info('Scanner dihentikan');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stopScanLoop();
    process.exit(0);
  });
}

// ─── Command: dry ────────────────────────────────────────────────────────────

async function cmdDry(): Promise<void> {
  // Override jadi DRY RUN
  process.env.DRY_RUN = 'true';

  // Reload — sederhana, re-assign dari env
  const dryConfig = { ...CONFIG, dryRun: true };

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     ⚠️  DRY RUN MODE FORCED              ║');
  console.log('║  Semua transaksi hanya simulasi          ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Jalankan scanner dalam mode dry
  await runCycle();
}

// ─── Command: summary ────────────────────────────────────────────────────────

async function cmdSummary(): Promise<void> {
  const summary = getDryRunSummary();

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║        Dry Run Summary                   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`  Total Trades:   ${summary.totalTrades}`);
  console.log(`  ○ Wins:         ${summary.wins}`);
  console.log(`  ● Losses:       ${summary.losses}`);
  console.log(`  Win Rate:       ${summary.winRate}%`);
  console.log(`  Total PnL:      ${summary.totalPnL > 0 ? '+' : ''}${summary.totalPnL}%`);
  console.log(`  Avg PnL/Trade:  ${summary.avgPnL > 0 ? '+' : ''}${summary.avgPnL}%`);
  console.log('');

  if (summary.records.length === 0) {
    console.log('  (Belum ada record dry-run)');
    console.log('');
    return;
  }

  // Tampilkan 10 record terakhir
  const recent = summary.records.slice(-10).reverse();
  console.log('  10 Record Terakhir:');
  console.log('  ────────────────────────────────────────────────');
  for (const r of recent) {
    const emoji = r.result === 'win' ? '✅' : r.result === 'loss' ? '❌' : '⏳';
    const pnl = r.pnlPercent !== null ? `${r.pnlPercent > 0 ? '+' : ''}${r.pnlPercent.toFixed(2)}%` : 'open';
    const time = new Date(r.timestamp).toLocaleString('id-ID');
    console.log(`  ${emoji} ${r.trade?.tokenSymbol || '?'} | ${pnl} | ${r.note.slice(0, 60)} | ${time}`);
  }
  console.log('  ────────────────────────────────────────────────');
  console.log('');
}

// ─── CLI Router ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const command = process.argv[2]?.toLowerCase() || 'trade';

  switch (command) {
    case 'trade':
      await cmdTrade();
      break;

    case 'dry':
      await cmdDry();
      break;

    case 'summary':
      await cmdSummary();
      break;

    case 'clear':
      clearDryRun();
      console.log('✅ Semua record dry-run dihapus');
      break;

    case 'help':
    case '--help':
    case '-h':
      console.log(`
  Usage: npm run <command>

  Commands:
    trade     Jalankan scanner (default)
    dry       Paksa DRY RUN, jalankan scanner
    summary   Tampilkan hasil dry-run
    clear     Hapus semua record dry-run
    help      Tampilkan ini
      `);
      break;

    default:
      console.log(`Perintah tidak dikenal: "${command}". Gunakan "npm run help".`);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`❌ Fatal error: ${msg}`);
  logger.error('Fatal error', { error: msg });
  process.exit(1);
});
