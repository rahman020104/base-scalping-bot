// ============================================================
// Helpers — Fungsi bantuan umum
// ============================================================

/**
 * Format angka ke format USD
 * Contoh: formatUSD(1234567) → "$1,234,567"
 */
export function formatUSD(value: number): string {
  if (isNaN(value)) return '$0';

  return value >= 0
    ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `-$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Sleep — nunggu dalam milidetik
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validasi address Ethereum/Base
 * Format: 0x + 40 hex chars (case insensitive)
 */
export function validateAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Hitung PnL dalam persen
 * Contoh: calculatePnL(100, 150) → 50  (naik 50%)
 *         calculatePnL(100, 70)  → -30 (turun 30%)
 */
export function calculatePnL(entryPrice: number, currentPrice: number): number {
  if (entryPrice <= 0) return 0;
  if (isNaN(entryPrice) || isNaN(currentPrice)) return 0;

  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

/**
 * Generate ID unik (untuk dry-run record, dll)
 */
export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}_${rand}`;
}
