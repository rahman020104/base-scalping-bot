# Base Scalping Bot — CONTEXT.md
Baca ini sebelum kerjakan apapun.

## Tujuan
Bot trading otomatis di Base chain.
Strategi: scalping token baru (< 24 jam).
Modal: $200. Target: +100-200% per win, SL -30%.

## Mode
- DRY RUN: simulasi tanpa uang asli (default)
- LIVE: eksekusi transaksi nyata (butuh private key)

## Alur Kerja
1. DISCOVER    → cari token baru < 24 jam via DexScreener
2. FILTER      → buang honeypot, liquidity < $10K
3. INDICATOR   → cek 5 sinyal, min 3 harus hijau
4. DRY RUN     → catat simulasi ke dryrun.json
5. EXECUTE     → beli via Uniswap V2 Base
6. MONITOR     → pantau harga tiap 30 detik
7. EXIT        → jual di TP +150% atau SL -30%

## Indikator (services/indicators.ts)
1. volumeSpike    → volume naik > 200% dalam 5 menit
2. buyPressure    → buyer > 60% dari total transaksi
3. liquidityRange → TVL antara $10K - $500K
4. priceMovement  → harga naik 20-100% (belum terlambat)
5. holderGrowth   → holder bertambah > 10% per jam

## Struktur File
src/
├── config/index.ts           → baca .env, export semua config
├── types/index.ts            → semua interface/type
├── utils/logger.ts           → logging ke file + console
├── utils/helpers.ts          → fungsi bantuan umum
├── services/
│   ├── honeypotDetector.ts   → cek scam via honeypot.is
│   ├── dexScanner.ts         → cari token baru DexScreener
│   ├── indicators.ts         → hitung 5 indikator scalping
│   ├── executor.ts           → eksekusi beli/jual blockchain
│   └── monitor.ts            → pantau posisi aktif
├── core/
│   ├── dryRun.ts             → simulasi trading, catat JSON
│   ├── tradeManager.ts       → atur posisi, TP, SL
│   └── scanner.ts            → orkestasi alur utama
└── index.ts                  → CLI, pintu masuk

## Blockchain
- Chain: Base (chainId: 8453)
- Router: Uniswap V2 Base
  0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24
- Library: ethers.js v6
- RPC: dari .env BASE_RPC_URL

## Risk Management
- Max per trade: $20 (10% dari $200)
- Max posisi aktif: 5 token sekaligus
- TP: +150%
- SL: -30%
- Slippage max: 5%

## .env yang dibutuhkan
BASE_RPC_URL=
BASE_RPC_FALLBACK=
PRIVATE_KEY=
MIN_LIQUIDITY_USD=10000
MAX_LIQUIDITY_USD=500000
MAX_RISK_SCORE=30
TRADE_AMOUNT_USD=20
DRY_RUN=true

## Aturan Penting
- DRY_RUN=true by default, jangan ubah sampai dry run
  1 minggu sukses
- Jangan pernah hardcode private key
- Setiap function harus ada error handling
- Gunakan TypeScript strict, tidak boleh ada "any"
