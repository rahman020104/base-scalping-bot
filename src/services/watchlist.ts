import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Token } from '../types/index';
import { createContextLogger } from '../utils/logger';

const wlLog = createContextLogger('watchlist');

// ─── Path ──────────────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), 'data');
const FILE_PATH = join(DATA_DIR, 'watchlist.json');

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WatchlistItem {
  token: Token;
  athPrice: number;
  pairAddress: string;
  dateAdded: Date;
  dropPercent: number;
}

// ─── Internal file helpers ─────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

async function loadAll(): Promise<WatchlistItem[]> {
  try {
    if (!existsSync(FILE_PATH)) return [];
    const raw = await readFile(FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.map((item: any) => ({
      ...item,
      dateAdded: new Date(item.dateAdded),
    }));
  } catch (err) {
    wlLog.error('Gagal load watchlist', err);
    return [];
  }
}

async function saveAll(items: WatchlistItem[]): Promise<void> {
  await ensureDir();
  await writeFile(FILE_PATH, JSON.stringify(items, null, 2), 'utf-8');
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function addToWatchlist(
  token: Token,
  athPrice: number,
  pairAddress: string
): Promise<void> {
  if (!token.address) {
    wlLog.warn('addToWatchlist: token tanpa address');
    return;
  }

  const items = await loadAll();
  const existing = items.find(
    (item) => item.token.address.toLowerCase() === token.address.toLowerCase()
  );

  if (existing) {
    wlLog.info(`${token.symbol} sudah di watchlist`);
    return;
  }

  const dropPercent =
    athPrice > 0 && token.priceUsd > 0
      ? Math.round((1 - token.priceUsd / athPrice) * 100 * 100) / 100
      : 0;

  const newItem: WatchlistItem = {
    token,
    athPrice,
    pairAddress,
    dateAdded: new Date(),
    dropPercent,
  };

  items.push(newItem);
  await saveAll(items);
  wlLog.info(`${token.symbol} ditambahkan ke watchlist (drop ${dropPercent}%)`);
}

export async function removeFromWatchlist(tokenAddress: string): Promise<void> {
  const items = await loadAll();
  const filtered = items.filter(
    (item) => item.token.address.toLowerCase() !== tokenAddress.toLowerCase()
  );

  if (filtered.length === items.length) {
    wlLog.warn(`${tokenAddress} tidak ditemukan di watchlist`);
    return;
  }

  await saveAll(filtered);
  wlLog.info(`${tokenAddress} dihapus dari watchlist`);
}

export async function getWatchlist(): Promise<WatchlistItem[]> {
  return loadAll();
}

export default { addToWatchlist, removeFromWatchlist, getWatchlist };
