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
import { getDryRunSummary, clearDryRun, getOpenRecords } from './core/dryRun';

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
  console.log(`║  Max:    ${CONFIG.maxPositions} posisi                      ║`);
  console.log(`║  TP:     +${CONFIG.tpPercent}% | SL: -${CONFIG.slPercent}%              ║`);
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

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     ⚠️  DRY RUN MODE FORCED              ║');
  console.log('║  Scan sekali, exit — gak monitoring      ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Jalankan scanner dalam mode dry (1 siklus doang)
  await runCycle();

  // Langsung exit — gak usah nunggu monitoring
  process.exit(0);
}

// ─── Command: summary ────────────────────────────────────────────────────────

function fmt(value: number, prefix = ''): string {
  return value > 0 ? `${prefix}${value.toFixed(2)}%` : `${value.toFixed(2)}%`;
}

// ─── Fetch harga dari DexScreener ────────────────────────────────────────────

async function fetchPrice(address: string): Promise<number | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const pair = (data.pairs || []).find((p: any) => p.chainId === 'base');
    return pair ? parseFloat(pair.priceUsd || '0') : null;
  } catch {
    return null;
  }
}

// ─── Command: summary ────────────────────────────────────────────────────────

async function cmdSummary(): Promise<void> {
  const summary = getDryRunSummary();

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║        Dry Run Summary                   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // ── Stats ──────────────────────────────────────────────────────────────
  const barW = Math.round(summary.winRate / 5);
  const barL = 20 - barW;
  const winBar = '█'.repeat(Math.max(0, barW));
  const lossBar = '░'.repeat(Math.max(0, barL));

  console.log(`  📊 Performance`);
  console.log(`  ──────────────────────────────────`);
  console.log(`  Total Trades    ${summary.totalTrades}`);
  console.log(`  ✅ Wins         ${summary.wins}`);
  console.log(`  ❌ Losses       ${summary.losses}`);
  console.log(`  🎯 Win Rate     ${summary.winRate}%  ${winBar}${lossBar}`);
  console.log(`  💰 Total PnL    ${fmt(summary.totalPnL, '+')}`);
  console.log(`  📈 Avg/Trade    ${fmt(summary.avgPnL, '+')}`);
  console.log('');

  // ── Riwayat ────────────────────────────────────────────────────────────
  if (summary.records.length === 0) {
    console.log('  (Belum ada record dry-run)');
    console.log('');
    return;
  }

  const recent = summary.records.slice(-15).reverse();
  console.log(`  📋 ${recent.length} Record Terakhir:`);
  console.log(`  ──────────────────────────────────────────────────────────────────────────`);
  console.log(`  ${'Token'.padEnd(10)} ${'Result'.padStart(7)} ${'PnL%'.padStart(9)} ${'PnL $'.padStart(9)} ${'Alasan'.padEnd(30)}`);
  console.log(`  ──────────────────────────────────────────────────────────────────────────`);

  for (const r of recent) {
    const symbol = (r.trade?.tokenSymbol || '?').padEnd(10);
    const result = (r.result === 'win' ? '✅ WIN' : r.result === 'loss' ? '❌ LOSS' : '⏳ OPEN').padStart(7);

    // Untuk posisi open, fetch harga real-time
    let pnlValue = r.pnlPercent;
    if (r.result === 'open' && r.trade) {
      const price = await fetchPrice(r.trade.tokenAddress);
      const current = price ?? r.trade.entryPrice;
      pnlValue = ((current - r.trade.entryPrice) / r.trade.entryPrice) * 100;
    }

    const pnlPct = pnlValue !== null
      ? `${pnlValue > 0 ? '+' : ''}${pnlValue.toFixed(2)}%`.padStart(9)
      : '   -  ';

    // USD PnL = persentase * tradeAmount / 100
    const pnlUsd = pnlValue !== null
      ? `${pnlValue > 0 ? '+' : ''}$${(pnlValue * CONFIG.tradeAmountUsd / 100).toFixed(2)}`.padStart(9)
      : '   -  ';

    const note = r.note.length > 35 ? r.note.slice(0, 32) + '...' : r.note;
    console.log(`  ${symbol} ${result} ${pnlPct} ${pnlUsd} ${note}`);
  }
  console.log(`  ──────────────────────────────────────────────────────────────────────────`);
  console.log('');
}

// ─── Command: positions ──────────────────────────────────────────────────────

async function cmdPositions(watch = false): Promise<void> {
  const render = async (): Promise<void> => {
    const records = getOpenRecords();
    if (records.length === 0) {
      console.log('  Tidak ada posisi aktif.');
      return;
    }

    // Fetch harga terbaru
    type Row = { symbol: string; entry: number; current: number; pnlPct: string; pnlUsd: string; tp: number; sl: number; status: string };
    const rows: Row[] = [];

    for (const r of records) {
      if (!r.trade) continue;
      const price = await fetchPrice(r.trade.tokenAddress);
      const current = price ?? r.trade.entryPrice;
      const pnl = ((current - r.trade.entryPrice) / r.trade.entryPrice) * 100;
      const tpPct = CONFIG.tpPercent;
      const slPct = CONFIG.slPercent;
      rows.push({
        symbol: r.trade.tokenSymbol,
        entry: r.trade.entryPrice,
        current,
        pnlPct: `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}%`,
        pnlUsd: `${pnl > 0 ? '+' : ''}$${(pnl * CONFIG.tradeAmountUsd / 100).toFixed(2)}`,
        tp: r.trade.takeProfit,
        sl: r.trade.stopLoss,
        status: price === null ? '⏳' : pnl >= tpPct ? '🎯 TP' : pnl <= -slPct ? '🛑 SL' : '✅',
      });
    }

    // Tabel
    const sep = `  ────────── ────────── ────────── ────────── ────────── ────────── ────────`;
    console.log(`  ${sep}`);
    console.log(`  ${'Token'.padEnd(10)} ${'Entry $'.padStart(10)} ${'Now $'.padStart(10)} ${'PnL%'.padStart(10)} ${'PnL $'.padStart(9)} ${'TP $'.padStart(10)} ${'SL $'.padStart(8)}`);
    console.log(`  ${sep}`);
    for (const row of rows) {
      console.log(
        `  ${row.symbol.padEnd(10)} ` +
        `${row.entry.toFixed(4).padStart(10)} ` +
        `${row.current.toFixed(4).padStart(10)} ` +
        `${(row.pnlPct).padStart(10)} ` +
        `${(row.pnlUsd).padStart(9)} ` +
        `${row.tp.toFixed(4).padStart(10)} ` +
        `${row.sl.toFixed(4).padStart(8)}`
      );
    }
    console.log(`  ${sep}`);
    console.log(`  ${rows.length} posisi aktif`);
  };

  await render();

  if (watch) {
    console.log('  Memantau tiap 30 detik... (Ctrl+C berhenti)');
    setInterval(render, CONFIG.monitorIntervalSeconds * 1000);
  }
}

// ─── CLI Router ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const command = process.argv[2]?.toLowerCase() || 'trade';
  const watch = process.argv.includes('--watch') || process.argv.includes('-w');

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

    case 'positions':
      await cmdPositions(watch);
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
    trade       Jalankan scanner + monitoring
    dry         Scan sekali (dry run)
    positions   Lihat posisi aktif
    positions --watch  Pantau posisi tiap 30 detik
    summary     Tampilkan hasil dry-run
    clear       Hapus semua record dry-run
    help        Tampilkan ini
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
