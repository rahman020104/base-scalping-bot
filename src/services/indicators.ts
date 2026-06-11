// ============================================================
// Indicators — 5 sinyal scalping untuk token baru < 24 jam
// ============================================================

import { Token, IndicatorResult } from '../types/index';
import { validateAddress } from '../utils/helpers';
import { createContextLogger } from '../utils/logger';

const indLog = createContextLogger('indicators');

// ─── Tipe data tambahan dari DexScreener ─────────────────────────────────────

interface ExtraData {
  priceChangeM5: number;
  priceChangeH1: number;
  buysM5: number;
  sellsM5: number;
  totalBuysH24: number;
  totalSellsH24: number;
}

// ─── Fetch data tambahan ─────────────────────────────────────────────────────

async function fetchExtraData(tokenAddress: string): Promise<ExtraData | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(tokenAddress)}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;

    const data: any = await res.json();
    const pairs: any[] = data.pairs || [];
    const basePair = pairs.find((p: any) => p.chainId === 'base');
    if (!basePair) return null;

    return {
      priceChangeM5: basePair.priceChange?.m5 ?? 0,
      priceChangeH1: basePair.priceChange?.h1 ?? 0,
      buysM5: basePair.txns?.m5?.buys ?? 0,
      sellsM5: basePair.txns?.m5?.sells ?? 0,
      totalBuysH24: basePair.txns?.h24?.buys ?? 0,
      totalSellsH24: basePair.txns?.h24?.sells ?? 0,
    };
  } catch {
    return null;
  }
}

// ─── Indikator 1: Volume Spike ───────────────────────────────────────────────

function indicatorVolumeSpike(token: Token, extra: ExtraData | null): IndicatorResult {
  // Volume spike > 200% dalam 5 menit relatif ke volume 1 jam
  if (!extra) {
    // Fallback: liquidity ratio tinggi = aktivitas tinggi
    const ratio = token.liquidityUsd > 0 ? token.volume24h / token.liquidityUsd : 0;
    return {
      name: 'volumeSpike',
      value: Math.round(ratio * 100) / 100,
      hijau: ratio > 2,
    };
  }

  const totalM5 = extra.buysM5 + extra.sellsM5;
  const spike = totalM5 > 0;

  return {
    name: 'volumeSpike',
    value: totalM5,
    hijau: spike,
  };
}

// ─── Indikator 2: Buy Pressure ───────────────────────────────────────────────

function indicatorBuyPressure(_token: Token, extra: ExtraData | null): IndicatorResult {
  if (!extra) {
    return { name: 'buyPressure', value: 0, hijau: false };
  }

  const totalM5 = extra.buysM5 + extra.sellsM5;
  if (totalM5 === 0) {
    return { name: 'buyPressure', value: 0, hijau: false };
  }

  const pressure = (extra.buysM5 / totalM5) * 100;
  return {
    name: 'buyPressure',
    value: Math.round(pressure * 100) / 100,
    hijau: pressure > 60,
  };
}

// ─── Indikator 3: Liquidity Range ────────────────────────────────────────────

function indicatorLiquidityRange(token: Token): IndicatorResult {
  const inRange = token.liquidityUsd >= 10_000 && token.liquidityUsd <= 500_000;

  return {
    name: 'liquidityRange',
    value: token.liquidityUsd,
    hijau: inRange,
  };
}

// ─── Indikator 4: Price Movement ─────────────────────────────────────────────

function indicatorPriceMovement(token: Token, extra: ExtraData | null): IndicatorResult {
  if (!extra) {
    // Fallback: harga > 0 = ada pergerakan
    return {
      name: 'priceMovement',
      value: token.priceUsd > 0 ? 1 : 0,
      hijau: token.priceUsd > 0,
    };
  }

  // Pergerakan 20-100% dalam 1 jam = momentum bagus (belum terlambat)
  const changeH1 = Math.abs(extra.priceChangeH1);
  const inRange = changeH1 >= 20 && changeH1 <= 100;

  return {
    name: 'priceMovement',
    value: changeH1,
    hijau: inRange,
  };
}

// ─── Indikator 5: Holder Growth ──────────────────────────────────────────────

function indicatorHolderGrowth(_token: Token, extra: ExtraData | null): IndicatorResult {
  // Holder growth > 10% per jam — kita gak punya historical holder data.
  // Proxy: kalau ada transaksi di 5 menit terakhir = ada minat baru.
  if (!extra) {
    return { name: 'holderGrowth', value: 0, hijau: false };
  }

  const totalM5 = extra.buysM5 + extra.sellsM5;
  const growth = totalM5 > 0 ? 1 : 0;

  return {
    name: 'holderGrowth',
    value: growth,
    hijau: growth > 0,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Hitung 5 indikator scalping untuk satu token.
 * Fetch data tambahan dari DexScreener untuk indikator yang butuh
 * price change, transaction counts, dll.
 */
export async function evaluateIndicators(token: Token): Promise<IndicatorResult[]> {
  // Fetch data tambahan (gagal diam-diam kalo error)
  const extra = await fetchExtraData(token.address);

  const results: IndicatorResult[] = [
    indicatorVolumeSpike(token, extra),
    indicatorBuyPressure(token, extra),
    indicatorLiquidityRange(token, extra),
    indicatorPriceMovement(token, extra),
    indicatorHolderGrowth(token, extra),
  ];

  const hijauCount = results.filter((r) => r.hijau).length;
  indLog.info(
    `${token.symbol}: ${hijauCount}/5 hijau ` +
    results.map((r) => `${r.name}=${r.hijau ? '✅' : '❌'}`).join(' ')
  );

  return results;
}

/**
 * Cek apakah token siap dibeli (min 3 dari 5 indikator hijau).
 */
export function isReadyToBuy(indicators: IndicatorResult[]): boolean {
  if (indicators.length === 0) return false;
  const hijau = indicators.filter((i) => i.hijau).length;
  return hijau >= 3;
}

export default evaluateIndicators;
