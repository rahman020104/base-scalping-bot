// ============================================================
// Config — Baca semua settings dari .env
// ============================================================
// ⚠️ Semua filter ada di sini. Jangan hardcode di file lain.
//    Biar user tinggal edit .env tanpa perlu compile ulang.
// ============================================================

import dotenv from 'dotenv';

dotenv.config();

// ─── Tipe config ─────────────────────────────────────────────────────────────

export interface Config {
  // ── Blockchain ──────────────────────────────────────────────────────────
  rpcUrl: string;
  rpcFallbackUrls: string[];
  allRpcUrls: string[];

  // ── Wallet ──────────────────────────────────────────────────────────────
  privateKey: string;
  dryRun: boolean;

  // ── Filter token ────────────────────────────────────────────────────────
  minLiquidityUsd: number;
  maxLiquidityUsd: number;
  minVolume24hUsd: number;
  maxTokenAgeHours: number;
  maxRiskScore: number;

  // ── Trading ─────────────────────────────────────────────────────────────
  tradeAmountUsd: number;
  maxPositions: number;
  tpPercent: number;     // take profit (%)
  slPercent: number;     // stop loss (%)
  maxSlippagePercent: number;

  // ── Timing ──────────────────────────────────────────────────────────────
  scanIntervalMinutes: number;
  monitorIntervalSeconds: number;

  // ── API ─────────────────────────────────────────────────────────────────
  dexScreenerApi: string;
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

  // ── Filter token ─────────────────────────────────────────────────────────
  const minLiquidityUsd = parseInt(process.env.MIN_LIQUIDITY_USD || '10000', 10);
  const maxLiquidityUsd = parseInt(process.env.MAX_LIQUIDITY_USD || '500000', 10);
  const minVolume24hUsd = parseInt(process.env.MIN_VOLUME_24H_USD || '50000', 10);
  const maxTokenAgeHours = parseInt(process.env.MAX_TOKEN_AGE_HOURS || '24', 10);
  const maxRiskScore = parseInt(process.env.MAX_RISK_SCORE || '30', 10);

  // ── Trading ──────────────────────────────────────────────────────────────
  const tradeAmountUsd = parseInt(process.env.TRADE_AMOUNT_USD || '20', 10);
  const maxPositions = parseInt(process.env.MAX_POSITIONS || '2', 10);
  const tpPercent = parseInt(process.env.TP_PERCENT || '150', 10);
  const slPercent = parseInt(process.env.SL_PERCENT || '30', 10);
  const maxSlippagePercent = parseInt(process.env.MAX_SLIPPAGE_PERCENT || '5', 10);

  // ── Timing ───────────────────────────────────────────────────────────────
  const scanIntervalMinutes = parseInt(process.env.SCAN_INTERVAL_MINUTES || '15', 10);
  const monitorIntervalSeconds = parseInt(process.env.MONITOR_INTERVAL_SECONDS || '30', 10);

  // ── API ───────────────────────────────────────────────────────────────────
  const dexScreenerApi = 'https://api.dexscreener.com/latest/dex';
  const honeypotIsApi = 'https://api.honeypot.is/v2/IsHoneypot';

  // ── Validasi ──────────────────────────────────────────────────────────────
  if (isNaN(minLiquidityUsd) || minLiquidityUsd < 0) throw new Error('MIN_LIQUIDITY_USD harus angka positif');
  if (isNaN(maxLiquidityUsd) || maxLiquidityUsd < 0) throw new Error('MAX_LIQUIDITY_USD harus angka positif');
  if (maxLiquidityUsd <= minLiquidityUsd) throw new Error('MAX_LIQUIDITY_USD harus lebih besar dari MIN_LIQUIDITY_USD');
  if (isNaN(maxRiskScore) || maxRiskScore < 0 || maxRiskScore > 100) throw new Error('MAX_RISK_SCORE harus antara 0-100');
  if (isNaN(tradeAmountUsd) || tradeAmountUsd <= 0) throw new Error('TRADE_AMOUNT_USD harus angka positif');
  if (isNaN(maxPositions) || maxPositions < 1 || maxPositions > 20) throw new Error('MAX_POSITIONS harus antara 1-20');
  if (isNaN(tpPercent) || tpPercent <= 0) throw new Error('TP_PERCENT harus angka positif');
  if (isNaN(slPercent) || slPercent <= 0) throw new Error('SL_PERCENT harus angka positif');
  if (isNaN(maxSlippagePercent) || maxSlippagePercent <= 0 || maxSlippagePercent > 50) throw new Error('MAX_SLIPPAGE_PERCENT harus antara 1-50');
  if (isNaN(minVolume24hUsd) || minVolume24hUsd < 0) throw new Error('MIN_VOLUME_24H_USD harus angka positif');
  if (isNaN(maxTokenAgeHours) || maxTokenAgeHours < 1) throw new Error('MAX_TOKEN_AGE_HOURS minimal 1');
  if (isNaN(scanIntervalMinutes) || scanIntervalMinutes < 1) throw new Error('SCAN_INTERVAL_MINUTES minimal 1');
  if (isNaN(monitorIntervalSeconds) || monitorIntervalSeconds < 5) throw new Error('MONITOR_INTERVAL_SECONDS minimal 5');

  return {
    rpcUrl,
    rpcFallbackUrls,
    allRpcUrls,
    privateKey,
    dryRun,
    minLiquidityUsd,
    maxLiquidityUsd,
    minVolume24hUsd,
    maxTokenAgeHours,
    maxRiskScore,
    tradeAmountUsd,
    maxPositions,
    tpPercent,
    slPercent,
    maxSlippagePercent,
    scanIntervalMinutes,
    monitorIntervalSeconds,
    dexScreenerApi,
    honeypotIsApi,
  };
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const CONFIG: Config = loadConfig();
export default CONFIG;
