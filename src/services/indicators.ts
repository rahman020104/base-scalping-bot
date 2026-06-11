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

interface PSARResult {
  values: number[];
  lastUpFlip: number | null;
}

interface BBResult {
  upper: number;
  mid: number;
  lower: number;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function getPairAddress(tokenAddress: string): Promise<string | null> {
  const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(tokenAddress)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data: any = await res.json();
  const pairs: any[] = data.pairs || [];
  const basePair = pairs.find((p: any) => p.chainId === 'base');
  return basePair?.pairAddress ?? null;
}

async function fetchCandlesByPair(
  pairAddress: string,
  resolution: string
): Promise<Candle[] | null> {
  try {
    const url = `https://api.dexscreener.com/latest/dex/candles/base/${pairAddress}?res=${resolution}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const raw: any[] = data.pairs?.[0]?.candles || [];
    if (raw.length < 2) return null;
    return raw.map((c: any) => ({
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

async function fetchCandles(tokenAddress: string): Promise<Candle[] | null> {
  const pairAddress = await getPairAddress(tokenAddress);
  if (!pairAddress) return null;
  const candles = await fetchCandlesByPair(pairAddress, '60');
  if (!candles || candles.length < 20) return null;
  return candles;
}

// ─── Shared calculators ──────────────────────────────────────────────────────

function calcPSAR(candles: Candle[]): PSARResult {
  if (candles.length < 2) return { values: [], lastUpFlip: null };

  const values: number[] = [];
  const first = candles[0];
  const second = candles[1];
  let isUp = second.close >= first.close;
  let ep = isUp
    ? Math.max(first.high, second.high)
    : Math.min(first.low, second.low);
  let sar = isUp
    ? Math.min(first.low, second.low)
    : Math.max(first.high, second.high);
  let lastUpFlip: number | null = null;
  let af = 0.02;

  values.push(0);
  values.push(Math.round(sar * 1e8) / 1e8);

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
        lastUpFlip = i;
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

    values.push(Math.round(sar * 1e8) / 1e8);
  }

  return { values, lastUpFlip };
}

function calcBB(candles: Candle[], period: number): BBResult {
  const closes = candles.map((c) => c.close);
  const recent = closes.slice(-period);
  const sma = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((sum, val) => sum + (val - sma) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: sma + 2 * std,
    mid: sma,
    lower: sma - 2 * std,
  };
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
  const psar = calcPSAR(candles);
  if (psar.values.length < 2) {
    return { name: 'parabolicSAR', value: 0, hijau: false };
  }
  const lastSAR = psar.values[psar.values.length - 1];
  const currentPrice = candles[candles.length - 1].close;
  return {
    name: 'parabolicSAR',
    value: lastSAR,
    hijau: currentPrice > lastSAR,
  };
}

// ─── Indikator 3: Bollinger Bands ────────────────────────────────────────────

function indicatorBollingerBands(candles: Candle[]): IndicatorResult {
  if (candles.length < 20) {
    return { name: 'bollingerBands', value: 0, hijau: false };
  }

  const bb = calcBB(candles, 20);
  const currentPrice = candles[candles.length - 1].close;

  return {
    name: 'bollingerBands',
    value: Math.round(bb.lower * 1e8) / 1e8,
    hijau: currentPrice <= bb.lower,
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

// ─── Indikator 5: HTF Signal (1 jam) ────────────────────────────────────────
// SAR baru flip + titik SAR pertama setelah flip < Lower BB(21)

function indicatorHTF(candles: Candle[]): IndicatorResult {
  if (candles.length < 22) {
    return { name: 'htfSignal', value: 0, hijau: false };
  }

  const psar = calcPSAR(candles);
  const bb21 = calcBB(candles, 21);

  const lastIdx = candles.length - 1;
  const flipBaru = psar.lastUpFlip !== null && (lastIdx - psar.lastUpFlip) <= 1;
  if (!flipBaru) {
    return { name: 'htfSignal', value: 0, hijau: false };
  }

  const sarFlip = psar.values[psar.lastUpFlip!];
  const hijau = sarFlip < bb21.lower;

  return {
    name: 'htfSignal',
    value: Math.round(sarFlip * 1e8) / 1e8,
    hijau,
  };
}

// ─── Indikator 6: LTF Confirmation (5 menit) ────────────────────────────────
// Cek SAR flip di M5

async function indicatorLTF(pairAddress: string): Promise<IndicatorResult> {
  try {
    const candles = await fetchCandlesByPair(pairAddress, '5');
    if (!candles || candles.length < 10) {
      return { name: 'ltfConfirm', value: 0, hijau: false };
    }

    const psar = calcPSAR(candles);
    if (psar.values.length < 2) {
      return { name: 'ltfConfirm', value: 0, hijau: false };
    }

    const lastSAR = psar.values[psar.values.length - 1];
    const currentPrice = candles[candles.length - 1].close;
    const hijau = currentPrice > lastSAR;

    return {
      name: 'ltfConfirm',
      value: hijau ? 1 : 0,
      hijau,
    };
  } catch {
    return { name: 'ltfConfirm', value: 0, hijau: false };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function evaluateIndicators(token: Token): Promise<IndicatorResult[]> {
  const candles = await fetchCandles(token.address);

  if (!candles) {
    indLog.warn(`${token.symbol}: candle data tidak tersedia`);
    return [
      { name: 'fibonacci', value: 0, hijau: false },
      { name: 'parabolicSAR', value: 0, hijau: false },
      { name: 'bollingerBands', value: 0, hijau: false },
      { name: 'volumeConfirm', value: 0, hijau: false },
      { name: 'htfSignal', value: 0, hijau: false },
      { name: 'ltfConfirm', value: 0, hijau: false },
    ];
  }

  const pairAddress = await getPairAddress(token.address);
  const ltf = pairAddress ? await indicatorLTF(pairAddress) : { name: 'ltfConfirm', value: 0, hijau: false };

  const results: IndicatorResult[] = [
    indicatorFibonacci(candles),
    indicatorParabolicSAR(candles),
    indicatorBollingerBands(candles),
    indicatorVolumeConfirm(candles),
    indicatorHTF(candles),
    ltf,
  ];

  const hijauCount = results.filter((r) => r.hijau).length;
  indLog.info(
    `${token.symbol}: ${hijauCount}/6 hijau ` +
      results.map((r) => `${r.name}=${r.hijau ? '✅' : '❌'}`).join(' ')
  );

  return results;
}

export function isReadyToBuy(indicators: IndicatorResult[]): boolean {
  if (indicators.length < 6) return false;

  const htf = indicators.find((i) => i.name === 'htfSignal');
  const ltf = indicators.find((i) => i.name === 'ltfConfirm');

  if (!htf || !ltf) return false;

  return htf.hijau === true && ltf.hijau === true;
}

export default evaluateIndicators;
