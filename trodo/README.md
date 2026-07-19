# TRODO — Automated Trading Copilot (Chrome Extension)

TRODO links your exchange account with a **trade-only API key**, runs a
strategy (grid, trend-following, or an arbitrage price-spread scanner) on a
timer, and gates every trade through a risk manager (position sizing, stop
loss, trailing stop, daily drawdown limit).

## Brokers and account types

TRODO supports two brokers, each account linked independently:

- **Binance** (crypto) — spot trading, testnet by default.
- **Groww** (Indian stocks, via [Groww's Trading API](https://groww.in/trade-api/docs)) —
  equity (CASH) and F&O trading. Requires a Groww "Trading APIs" subscription
  and an API key/secret from the [Groww Cloud API Keys page](https://groww.in/trade-api/api-keys).
  Groww has no testnet, so a linked Groww account is live from the start —
  start with auto-execute off and watch the signal log before turning it on.

Each linked account also picks an **account type**:

- **Trading** — the normal mode. A strategy runs on a timer and, if
  auto-execute is on, proposes orders that pass through the risk manager.
- **Portfolio view** — read-only. Meant for mutual funds, SIPs, or any
  holding you want TRODO to track but never trade. This isn't just a UI
  toggle: `background.js` never calls a broker's order-placement function for
  a `portfolio_view` account, so there's no code path from this setting to a
  live order. (It's also a reasonable fit generally, since Groww's Trading
  API doesn't have an order-placement endpoint for mutual funds in the first
  place — TRODO can read a demat holdings snapshot, but "trading" a mutual
  fund through this API was never on the table.)

### Compliance gate for Groww auto-execute

Placing live orders on a SEBI-regulated broker through an API carries rules
(order tagging, your API subscription's own terms, exchange algo-trading
requirements) that a Binance testnet key doesn't. Before TRODO will
auto-execute a **Groww** account, Settings requires you to check an
acknowledgement that you've read Groww's API terms and understand that. This
is enforced twice: once in the Settings form, and again in `background.js`
right before an order would be placed — so a saved account with
`autoExecute: true` but no acknowledgement still won't trade.

## What TRODO will never ask for

- Your exchange **password**
- Your **PAN card**, Aadhaar, or any other ID document
- **Withdrawal-enabled** API keys — TRODO warns you if it detects one

If any tool or "trading bot" ever asks for these, that's a red flag, not a
feature. Exchanges built API keys specifically so third-party apps never
need your login.

## Install (unpacked, for now)

Chrome extensions distributed outside the Web Store are loaded as
"unpacked" during development/personal use:

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this `trodo/` folder
5. Pin the TRODO icon from the extensions toolbar menu

## First run

1. Click the TRODO icon → set a **vault passphrase**. This encrypts API
   secrets on your machine (AES-GCM, key derived via PBKDF2). It's never
   sent anywhere and never written to disk — if you clear it or restart
   Chrome, you'll unlock the vault again with the same passphrase.
2. Open **Settings** and link an account:
   - Create an API key on your exchange dedicated to TRODO
   - Enable **Spot & Margin Trading** only
   - Leave **Enable Withdrawals** off
   - Start on **Testnet** to confirm behavior before going live
3. Pick a strategy and risk settings, then save.

## How it runs in the background

Chrome extensions use a **service worker**, not a persistent daemon — it
wakes on a `chrome.alarms` timer (every 5 minutes here) while Chrome is
open, checks linked accounts, and goes back to sleep. This is different
from a server/VPS process:

- ✅ Runs without you keeping a terminal window open
- ✅ No separate server to maintain
- ⚠️ Stops if Chrome itself is fully closed or the computer sleeps
- ⚠️ Not a substitute for a hosted bot if you need true 24/7 uptime
  through outages/reboots

If you need genuine 24/7 execution later, the same `lib/` modules
(`binanceClient.js`, `riskManager.js`, `strategies.js`) can run unmodified
in a small Node.js process on a VPS — the extension UI would just become a
remote control for it instead of the thing executing trades directly.

## Project layout

```
manifest.json       Extension config (Manifest V3)
background.js       Service worker: alarm tick, strategy runs, risk gate
popup.html/js/css    Toolbar dashboard: balances, activity log, vault unlock
options.html/js/css  Link accounts, choose strategy, set risk limits
lib/crypto.js        AES-GCM encryption for API secrets (PBKDF2-derived key)
lib/binanceClient.js Signed REST calls to Binance (account, price, klines, order)
lib/growwClient.js   REST calls to Groww's Trading API (token exchange, holdings, quote, order)
lib/riskManager.js   Position sizing, stop loss, trailing stop, drawdown halt
lib/strategies.js    Grid, trend-following (RSI/MACD), arbitrage spread scan
```

`background.js` routes each account to the right client by its `broker`
field (`binance` | `groww`) via small `getSnapshotForBroker` /
`getPriceForBroker` / `placeOrderForBroker` helpers, and branches on
`assetMode` (`trading` | `portfolio_view`) before any of that even runs — see
"Brokers and account types" above.

## Notes on this build

- Binance is wired to its public API (testnet by default). Groww is wired to
  its official Trading API (equity CASH + FNO orders; no mutual fund order
  placement, no testnet). Adding a third broker means writing a client with
  the same shape (`getAccountSnapshot`, `getPrice`, `placeOrder`) and adding a
  branch in the three `*ForBroker` helpers in `background.js`.
- Trend-following (RSI/MACD) is Binance-only in this build — it needs
  historical candles, which aren't wired up for Groww yet. Grid and
  arbitrage-scan work for both.
- Arbitrage mode currently only emits a signal when a price spread clears
  fees; it doesn't place cross-exchange orders, since that needs two
  linked accounts and careful handling of transfer time between venues.
- This is a starting framework, not investment advice — test thoroughly
  before going live, and treat `autoExecute` as off by default until you
  trust a strategy's behavior on paper (Binance testnet) or on a small
  position size (Groww, which has no testnet).
