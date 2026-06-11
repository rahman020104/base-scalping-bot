// ============================================================
// Config — Baca semua settings dari .env
// ============================================================
// Hanya file ini yang boleh baca .env.
// Semua file lain import CONFIG dari sini.

import dotenv from 'dotenv';

dotenv.config();

// ─── Tipe config ─────────────────────────────────────────────────────────────

export interface Config {
  /** Primary RPC URL untuk Base chain */
  rpcUrl: string;
  /** Daftar fallback RPC URL (dipisah koma di .env) */
  rpcFallbackUrls: string[];
  /** Semua RPC URLs (rpcUrl + fallback) */
  allRpcUrls: string[];

  /** Private key wallet (kosong kalo dry-run) */
  privateKey: string;

  /** Mode dry-run: true = simulasi, false = real tx */
  dryRun: boolean;

  /** Likuiditas minimal token ($) */
  minLiquidityUsd: number;
  /** Likuiditas maksimal token ($) */
  maxLiquidityUsd: number;
  /** Risk score maksimal (0-100) */
  maxRiskScore: number;

  /** Jumlah USD per trade (dari modal $200) */
  tradeAmountUsd: number;

  /** API endpoint DexScreener */
  dexScreenerApi: string;

  /** API endpoint honeypot.is */
  honeypotIsApi: string;
}

// ─── Load & validasi ─────────────────────────────────────────────────────────

function loadConfig(): Config {
  // ── Required ──────────────────────────────────────────────────────────────
  const rpcUrl = process.env.BASE_RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error(
      'BASE_RPC_URL wajib diisi di .env\n' +
      'Contoh: BASE_RPC_URL=https://mainnet.base.org'
    );
  }

  // ── RPC fallback ──────────────────────────────────────────────────────────
  const rawFallback = (process.env.BASE_RPC_FALLBACK || '').trim();
  const rpcFallbackUrls: string[] = rawFallback
    ? rawFallback.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const allRpcUrls = [rpcUrl, ...rpcFallbackUrls];

  // ── Wallet ────────────────────────────────────────────────────────────────
  const privateKey = (process.env.PRIVATE_KEY || '').trim();

  // ── Mode ──────────────────────────────────────────────────────────────────
  const dryRunRaw = (process.env.DRY_RUN || 'true').trim().toLowerCase();
  const dryRun = dryRunRaw !== 'false' && dryRunRaw !== '0';

  // ── Numeric ───────────────────────────────────────────────────────────────
  const minLiquidityUsd = parseInt(process.env.MIN_LIQUIDITY_USD || '10000', 10);
  const maxLiquidityUsd = parseInt(process.env.MAX_LIQUIDITY_USD || '500000', 10);
  const maxRiskScore = parseInt(process.env.MAX_RISK_SCORE || '30', 10);
  const tradeAmountUsd = parseInt(process.env.TRADE_AMOUNT_USD || '20', 10);

  // ── API ───────────────────────────────────────────────────────────────────
  const dexScreenerApi = 'https://api.dexscreener.com/latest/dex';
  const honeypotIsApi = 'https://api.honeypot.is/v2/IsHoneypot';

  // ── Validasi numeric ──────────────────────────────────────────────────────
  if (isNaN(minLiquidityUsd) || minLiquidityUsd < 0) {
    throw new Error('MIN_LIQUIDITY_USD harus angka positif');
  }
  if (isNaN(maxLiquidityUsd) || maxLiquidityUsd < 0) {
    throw new Error('MAX_LIQUIDITY_USD harus angka positif');
  }
  if (maxLiquidityUsd <= minLiquidityUsd) {
    throw new Error('MAX_LIQUIDITY_USD harus lebih besar dari MIN_LIQUIDITY_USD');
  }
  if (isNaN(maxRiskScore) || maxRiskScore < 0 || maxRiskScore > 100) {
    throw new Error('MAX_RISK_SCORE harus antara 0-100');
  }
  if (isNaN(tradeAmountUsd) || tradeAmountUsd <= 0) {
    throw new Error('TRADE_AMOUNT_USD harus angka positif');
  }

  return {
    rpcUrl,
    rpcFallbackUrls,
    allRpcUrls,
    privateKey,
    dryRun,
    minLiquidityUsd,
    maxLiquidityUsd,
    maxRiskScore,
    tradeAmountUsd,
    dexScreenerApi,
    honeypotIsApi,
  };
}

// ─── Singleton ───────────────────────────────────────────────────────────────

/** CONFIG — object berisi semua settings aplikasi. Dibaca sekali di startup. */
export const CONFIG: Config = loadConfig();

export default CONFIG;
