import { Token, IndicatorResult } from '../types/index';
import { createContextLogger } from '../utils/logger';

const indLog = createContextLogger('indicators');

// ─── Candle type ──────────────────────────────────────────────────────────────

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Fetch candles 1 jam dari DexScreener ────────────────────────────────────

async function fetchCandles(tokenAddress: string): Promise<Candle[] | null> {
  try {
    const searchUrl = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(tokenAddress)}`;
    const searchRes = await fetch(searchUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!searchRes.ok) return null;

    const searchData: any = await searchRes.json();
    const pairs: any[] = searchData.pairs || [];
    const basePair = pairs.find((p: any) => p.chainId === 'base');
    if (!basePair?.pairAddress) return null;

    const pairAddress = basePair.pairAddress;
    const candlesUrl = `https://api.dexscreener.com/latest/dex/candles/base/${pairAddress}?res=60`;

    const candlesRes = await fetch(candlesUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!candlesRes.ok) return null;

    const candlesData: any = await candlesRes.json();
    const rawCandles: any[] = candlesData.pairs?.[0]?.candles || [];
    if (rawCandles.length < 20) return null;

    return rawCandles.map((c: any) => ({
      timestamp: c.timestamp,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume),
    }));
  } catch {
    return null;
  }
}

// ─── Indikator 1: Fibonacci ──────────────────────────────────────────────────

function indicatorFibonacci(candles: Candle[]): IndicatorResult {
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  const diff = high - low;

  if (diff === 0) {
    return { name: 'fibonacci', value: 0, hijau: false };
  }

  const levels = {
    '0.382': high - diff * 0.382,
    '0.5': high - diff * 0.5,
    '0.618': high - diff * 0.618,
    '0.786': high - diff * 0.786,
  };

  const currentPrice = candles[candles.length - 1].close;
  const ratio = (currentPrice - low) / diff;
  const inZone = currentPrice >= levels['0.618'] && currentPrice <= levels['0.786'];

  return {
    name: 'fibonacci',
    value: Math.round(ratio * 1000) / 1000,
    hijau: inZone,
  };
}

// ─── Indikator 2: Parabolic SAR ──────────────────────────────────────────────

function indicatorParabolicSAR(candles: Candle[]): IndicatorResult {
  if (candles.length < 2) {
    return { name: 'parabolicSAR', value: 0, hijau: false };
  }

  const first = candles[0];
  const second = candles[1];
  let isUp = second.close >= first.close;
  let ep = isUp
    ? Math.max(first.high, second.high)
    : Math.min(first.low, second.low);
  let sar = isUp
    ? Math.min(first.low, second.low)
    : Math.max(first.high, second.high);
  let af = 0.02;

  for (let i = 2; i < candles.length; i++) {
    const c = candles[i];

    if (isUp) {
      if (c.low < sar) {
        isUp = false;
        sar = ep;
        ep = c.low;
        af = 0.02;
      } else {
        sar = sar + af * (ep - sar);
        if (i >= 2) {
          sar = Math.min(sar, candles[i - 1].low, candles[i - 2].low);
        } else {
          sar = Math.min(sar, candles[i - 1].low);
        }
        if (c.high > ep) {
          ep = c.high;
          af = Math.min(af + 0.02, 0.2);
        }
      }
    } else {
      if (c.high > sar) {
        isUp = true;
        sar = ep;
        ep = c.high;
        af = 0.02;
      } else {
        sar = sar + af * (ep - sar);
        if (i >= 2) {
          sar = Math.max(sar, candles[i - 1].high, candles[i - 2].high);
        } else {
          sar = Math.max(sar, candles[i - 1].high);
        }
        if (c.low < ep) {
          ep = c.low;
          af = Math.min(af + 0.02, 0.2);
        }
      }
    }
  }

  const currentPrice = candles[candles.length - 1].close;

  return {
    name: 'parabolicSAR',
    value: Math.round(sar * 1e8) / 1e8,
    hijau: currentPrice > sar,
  };
}

// ─── Indikator 3: Bollinger Bands ────────────────────────────────────────────

function indicatorBollingerBands(candles: Candle[]): IndicatorResult {
  if (candles.length < 20) {
    return { name: 'bollingerBands', value: 0, hijau: false };
  }

  const period = 20;
  const recent = candles.slice(-period);
  const closes = recent.map((c) => c.close);
  const sma = closes.reduce((a, b) => a + b, 0) / period;
  const variance = closes.reduce((sum, val) => sum + (val - sma) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const lower = sma - 2 * std;
  const currentPrice = candles[candles.length - 1].close;

  return {
    name: 'bollingerBands',
    value: Math.round(lower * 1e8) / 1e8,
    hijau: currentPrice <= lower,
  };
}

// ─── Indikator 4: Volume Confirm ─────────────────────────────────────────────

function indicatorVolumeConfirm(candles: Candle[]): IndicatorResult {
  if (candles.length < 20) {
    return { name: 'volumeConfirm', value: 0, hijau: false };
  }

  const recent = candles.slice(-20);
  const currentVol = recent[recent.length - 1].volume;
  const avgVol = recent.slice(0, -1).reduce((sum, c) => sum + c.volume, 0) / (recent.length - 1);

  return {
    name: 'volumeConfirm',
    value: avgVol > 0 ? Math.round((currentVol / avgVol) * 100) / 100 : 0,
    hijau: currentVol > avgVol,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function evaluateIndicators(token: Token): Promise<IndicatorResult[]> {
  const candles = await fetchCandles(token.address);

  if (!candles) {
    indLog.warn(`${token.symbol}: candle data tidak tersedia, semua indikator merah`);
    return [
      { name: 'fibonacci', value: 0, hijau: false },
      { name: 'parabolicSAR', value: 0, hijau: false },
      { name: 'bollingerBands', value: 0, hijau: false },
      { name: 'volumeConfirm', value: 0, hijau: false },
    ];
  }

  const results: IndicatorResult[] = [
    indicatorFibonacci(candles),
    indicatorParabolicSAR(candles),
    indicatorBollingerBands(candles),
    indicatorVolumeConfirm(candles),
  ];

  const hijauCount = results.filter((r) => r.hijau).length;
  indLog.info(
    `${token.symbol}: ${hijauCount}/4 hijau ` +
      results.map((r) => `${r.name}=${r.hijau ? '✅' : '❌'}`).join(' ')
  );

  return results;
}

export function isReadyToBuy(indicators: IndicatorResult[]): boolean {
  if (indicators.length === 0) return false;
  const hijau = indicators.filter((i) => i.hijau).length;
  return hijau >= 3;
}

export default evaluateIndicators;
