# TRODO — Chrome Web Store Listing Copy

Use this as a starting draft. Fields in [brackets] need your input before
submitting.

---

## Title
TRODO — Automated Trading Copilot

## Short description (132 char max)
Link exchange accounts with trade-only API keys and run grid, trend, or arbitrage-scan strategies with built-in risk controls.

## Detailed description

TRODO is a trading automation copilot that runs directly in your browser.
Link your exchange account with a trade-only API key — never your
password — and let TRODO watch the market and execute your chosen
strategy within limits you set.

**Built around your account's safety:**
- Never asks for your exchange password, PAN, or any ID document
- Stores API secrets encrypted on your device, locked behind a passphrase only you know
- Warns you if a linked API key has withdrawal access enabled — it should always be off
- Nothing is sent to any TRODO server. There is no backend. All calls go straight from your browser to the exchange's own API.

**Strategies included:**
- Grid trading — places buy/sell levels around a center price for ranging markets
- Trend following — RSI + MACD based entries and exits
- Arbitrage scan — flags price spreads across venues that clear trading fees (alerts only)

**Risk controls on every trade:**
- Max position size as a % of portfolio
- Stop loss and trailing stop
- Daily drawdown halt
- Max concurrent open positions

**Recommended first step:** run on the exchange's testnet with auto-execute
switched off, so TRODO only logs its signals while you confirm it behaves
the way you expect.

Currently supports [Binance — update if you've added more exchanges].
Source available at [GitHub link].

## Category
Productivity (or Tools, depending on what's available when you submit)

## Permissions justification (for the reviewer form)

- **storage** — Required to save linked account configuration, encrypted API secrets, and risk settings locally on the user's device. No data leaves the device.
- **alarms** — Required to periodically wake the background service worker and check strategy conditions while the browser is open.
- **notifications** — Required to alert the user of security warnings (e.g. a linked key has withdrawals enabled) and trading errors.
- **host_permissions (api.binance.com, testnet.binance.vision)** — Required to call the exchange's REST API directly from the browser to fetch balances/prices and place orders using the user's own API key.

## Support email
[your contact email]

## Privacy policy URL
Link to `PRIVACY_POLICY.md` hosted somewhere public (e.g. raw GitHub URL, or a page on your own site) — the Chrome Web Store requires a reachable URL, not just a file in the package.

## Screenshots checklist (1280x800, at least one required)
1. Popup showing a linked account with balances and activity log
2. Options page — "Link an account" form with the security callout visible
3. Options page — risk controls section
