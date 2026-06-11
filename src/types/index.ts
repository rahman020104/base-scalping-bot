// ============================================================
// Types — Semua interface/type untuk Base Scalping Bot
// ============================================================

/**
 * Token hasil discovery dari DexScreener
 */
export interface Token {
  /** Address kontrak token */
  address: string;
  /** Nama token */
  name: string;
  /** Symbol token */
  symbol: string;
  /** Nama pair LP (contoh: "cbBTC/WETH") */
  pairSymbol: string;
  /** Likuiditas dalam USD */
  liquidityUsd: number;
  /** Volume 24 jam dalam USD */
  volume24h: number;
  /** Umur token dalam jam (< 24 jam = target scalping) */
  ageHours: number;
  /** Harga saat ini dalam USD */
  priceUsd: number;
  /** Desimal token (default 18) */
  decimals: number;
}

/**
 * Hasil perhitungan satu indikator scalping
 */
export interface IndicatorResult {
  /** Nama indikator (volumeSpike, buyPressure, dll) */
  name: string;
  /** Nilai numerik hasil kalkulasi */
  value: number;
  /** true = sinyal hijau (memenuhi syarat) */
  hijau: boolean;
}

/**
 * Posisi trading yang sedang aktif atau sudah ditutup
 */
export interface TradePosition {
  /** Address token yang dibeli */
  tokenAddress: string;
  /** Symbol token */
  tokenSymbol: string;
  /** Harga entry (USD per token) */
  entryPrice: number;
  /** Jumlah ETH yang dipasang */
  amountInEth: string;
  /** Jumlah token yang diterima */
  amountOut: string;
  /** Harga TP (+150% dari entry) */
  takeProfit: number;
  /** Harga SL (-30% dari entry) */
  stopLoss: number;
  /** Status posisi */
  status: 'open' | 'closed' | 'stopped';
  /** Waktu entry */
  openedAt: Date;
  /** Waktu exit (kalo udah closed/stopped) */
  closedAt: Date | null;
  /** Realized PnL dalam persen */
  pnlPercent: number | null;
}

/**
 * Catatan hasil simulasi trading (dry-run)
 */
export interface DryRunRecord {
  /** ID unik record */
  id: string;
  /** Timestamp eksekusi */
  timestamp: Date;
  /** Data token */
  token: Token;
  /** Hasil kelima indikator */
  indicators: IndicatorResult[];
  /** Keputusan: buy atau skip */
  signal: 'buy' | 'skip';
  /** Kalo buy, detail posisi (simulasi) */
  trade: TradePosition | null;
  /** Hasil akhir setelah exit */
  result: 'win' | 'loss' | 'open';
  /** PnL dalam persen */
  pnlPercent: number | null;
  /** Catatan tambahan */
  note: string;
}
