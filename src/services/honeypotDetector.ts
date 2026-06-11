// ============================================================
// Honeypot Detector — Cek scam token via honeypot.is API
// ============================================================

import { validateAddress } from '../utils/helpers';

const HONEYPOT_IS_API = 'https://api.honeypot.is/v2/IsHoneypot';
const BASE_CHAIN_ID = 8453;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HoneypotResult {
  isHoneypot: boolean;
  sellTax: number;
  buyTax: number;
  reason: string;
}

// ─── Response dari API ───────────────────────────────────────────────────────

interface HoneypotApiResponse {
  simulationSuccess: boolean;
  honeypotResult: {
    isHoneypot: boolean;
  };
  simulationResult: {
    buyTax: string;
    sellTax: string;
    transferTax: string;
  };
}

// ─── Detector ────────────────────────────────────────────────────────────────

/**
 * Cek apakah token adalah honeypot via honeypot.is API.
 *
 * 🔐 Kalau API error, return isHoneypot: true — BUKAN false.
 *     Lebih baik false positive daripada kehilangan dana.
 */
export async function checkHoneypot(tokenAddress: string): Promise<HoneypotResult> {
  // ── Validasi address ──────────────────────────────────────────────────────
  if (!validateAddress(tokenAddress)) {
    return {
      isHoneypot: true,
      sellTax: 0,
      buyTax: 0,
      reason: `Invalid address format: ${tokenAddress}`,
    };
  }

  // ── Panggil API ───────────────────────────────────────────────────────────
  try {
    const url = `${HONEYPOT_IS_API}?address=${tokenAddress}&chainID=${BASE_CHAIN_ID}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        isHoneypot: true,
        sellTax: 0,
        buyTax: 0,
        reason: `API returned status ${response.status}`,
      };
    }

    const data = (await response.json()) as HoneypotApiResponse;

    // ── Parse hasil ─────────────────────────────────────────────────────────
    const isHoneypot = data.honeypotResult?.isHoneypot ?? false;
    const buyTax = parseFloat(data.simulationResult?.buyTax || '0');
    const sellTax = parseFloat(data.simulationResult?.sellTax || '0');

    // Simulation gagal = kemungkinan honeypot
    if (!data.simulationSuccess) {
      return {
        isHoneypot: true,
        sellTax,
        buyTax,
        reason: 'Simulasi gagal — kontrak kemungkinan blokir simulasi',
      };
    }

    // Sell tax > 25% = mencurigakan
    if (sellTax > 25) {
      return {
        isHoneypot: true,
        sellTax,
        buyTax,
        reason: `Sell tax ${sellTax}% — sangat tinggi`,
      };
    }

    return {
      isHoneypot,
      sellTax,
      buyTax,
      reason: isHoneypot
        ? 'API menandai sebagai honeypot'
        : 'Token aman — simulation passed',
    };
  } catch (error: unknown) {
    // 🔐 API error → return isHoneypot: true
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      isHoneypot: true,
      sellTax: 0,
      buyTax: 0,
      reason: `API unavailable: ${message}`,
    };
  }
}

export default checkHoneypot;
