# Base Scalping Bot — Architecture Brief

## 📋 Overview

Automated scalping bot for **Base chain** (Coinbase L2) using **Uniswap V2**, targeting newly-launched tokens (<24h). Built with TypeScript, ethers.js v6, and DexScreener API.

- **Capital:** $200 (configurable via .env)
- **TP:** +150% | **SL:** -30% (configurable)
- **Max Positions:** 2 (configurable)
- **Trade Amount:** $20/position (configurable)
- **Status:** ✅ DRY RUN (simulasi, aman)

---

## 🏗️ Architecture

```
src/
├── config/index.ts          # Singleton CONFIG — semua dari .env
├── types/index.ts           # Interface: Token, TradePosition, dll
├── index.ts                 # CLI entry point + commands
├── utils/
│   ├── logger.ts            # Winston (console error-only + file)
│   └── helpers.ts           # formatUSD, sleep, calculatePnL, etc
├── services/
│   ├── dexScanner.ts        # Discover new tokens <24h via DexScreener
│   ├── honeypotDetector.ts  # Cek scam token via honeypot.is API
│   ├── indicators.ts        # 5 sinyal scalping (≥3/5 to buy)
│   ├── executor.ts          # Buy/sell via Uniswap V2 Router
│   └── monitor.ts           # Polling harga tiap 30s, auto TP/SL
└── core/
    ├── tradeManager.ts      # Manajemen posisi (max N, open/close)
    ├── scanner.ts           # Orchestrator: scan → filter → trade
    └── dryRun.ts            # Simulasi + persist ke logs/dryrun.json
```

---

## 🔄 Flow

```
[Start] → discoverNewTokens() → [Token List]
    ↓
honeypotCheck() → ⛔ SKIP if honeypot
    ↓
evaluateIndicators() → ❌ SKIP if <3/5
    ↓
openPosition() → recordEntry() → monitor.start()
    ↓
Monitor loop (30s):
  checkPosition() → TP hit? → recordTP() → close
                  → SL hit? → recordSL() → close
                  → OPEN → continue
    ↓
Scan loop (15m):
  Cari token baru, ulang dari atas
```

---

## ⚙️ Config (.env)

| Variable | Default | Description |
|---|---|---|
| `MIN_LIQUIDITY_USD` | 10,000 | Likuiditas min |
| `MAX_LIQUIDITY_USD` | 500,000 | Likuiditas max |
| `MIN_VOLUME_24H_USD` | 50,000 | Volume 24h min |
| `MAX_TOKEN_AGE_HOURS` | 24 | Umur token max |
| `MAX_RISK_SCORE` | 30 | Risk score max |
| `TRADE_AMOUNT_USD` | 20 | USD per trade |
| `MAX_POSITIONS` | 2 | Posisi aktif max |
| `TP_PERCENT` | 150 | Take profit % |
| `SL_PERCENT` | 30 | Stop loss % |
| `MAX_SLIPPAGE_PERCENT` | 5 | Slippage max |
| `SCAN_INTERVAL_MINUTES` | 15 | Loop scan |
| `MONITOR_INTERVAL_SECONDS` | 30 | Loop monitor |

---

## 📊 5 Indicators (≥3 to Buy)

1. **Volume Spike** — volume 24h vs liquidity ratio
2. **Buy Pressure** — buy/sell tx ratio from DexScreener
3. **Liquidity Range** — within $10K–$500K
4. **Price Movement** — recent price change <50% (avoid pumped)
5. **Holder Growth** — approximated via tx count growth

---

## 🧪 Current Status (Dry Run)

```
📊 Performance
  Total Trades: 20
  Wins: 0 | Losses: 0 (all still open)
  Win Rate: 0%
  Total PnL: $0.00

📋 Active Positions (live prices):
  Token    Entry $     Now $      PnL%    PnL $
  SOL      65.02      65.08      +0.10%  +$0.02
  cbXRP     1.11       1.11       0.00%   $0.00
  VIRTUAL   0.5685     0.5719    +0.60%  +$0.12
```

---

## 🔧 CLI Commands

| Command | Description |
|---|---|
| `npm run trade` | Scan + monitor loop (dry/live) |
| `npm run dry` | One-shot scan, exit |
| `npm run summary` | Lihat riwayat + unrealized PnL |
| `npm run positions` | Tabel posisi aktif |
| `npm run watch` | Positions auto-refresh |
| `npm run clear` | Hapus semua data dry-run |

---

## 🛡️ Security

- Honeypot check via `honeypot.is` API v2 (chainId=8453)
- API failure → default `isHoneypot: true` (safe reject)
- All addresses validated via regex before API calls
- Private key validated length & format
- `.env` in `.gitignore` — never committed

---

## 📦 Dependencies

- **ethers.js** v6.16.0 — blockchain interaction
- **dotenv** — env config
- **winston** — logging
- **chalk** — terminal colors
- **DexScreener API** — token discovery + prices
- **honeypot.is API** — scam detection
- **Uniswap V2 Router** (Base): `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24`
- **WETH** (Base): `0x4200000000000000000000000000000000000006`

---

## 🚀 Next Steps

1. ✅ All filters in `.env` — no hardcode
2. ✅ Summary shows both PnL% and PnL $
3. ⏳ Run dry-run 1+ week to validate strategy
4. ⏳ Switch to LIVE mode after validation
