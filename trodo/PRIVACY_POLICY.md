# TRODO Privacy Policy

_Last updated: July 19, 2026_

TRODO is a browser extension that runs trading strategies against exchange
accounts you link yourself. This page explains exactly what data TRODO
handles, where it lives, and what it never touches.

## What TRODO stores

| Data | Where it's stored | Who can see it |
|---|---|---|
| Exchange API key | `chrome.storage.local` on your device | Only you, only on your device |
| Exchange API secret | `chrome.storage.local`, encrypted (AES-GCM, PBKDF2-derived key) | Only you — it is never stored or transmitted in plaintext |
| Vault passphrase | `chrome.storage.session` (in-memory only) | Only you, cleared when the browser closes; never written to disk |
| Strategy settings, risk limits | `chrome.storage.local` on your device | Only you |
| Activity log (signals, trades, errors) | `chrome.storage.local` on your device | Only you |

**None of this data is sent to TRODO's developer, to any TRODO-operated
server, or to any third party.** TRODO has no backend. The only network
calls the extension makes are directly from your browser to the exchange's
own API (e.g. Binance), using the key/secret you provided, to fetch prices,
balances, and place orders on your behalf.

## What TRODO never asks for or stores

- Your exchange account **password**
- **PAN card**, Aadhaar, passport, or any other government ID
- Bank account or card details
- Any data unrelated to running your chosen trading strategy

If a future version of TRODO ever needs to change this, this policy will
be updated first and the change will be called out in the release notes.

## Permissions used and why

- **storage** — save your linked accounts, encrypted secrets, and settings locally
- **alarms** — wake the background service worker periodically to check strategies
- **notifications** — warn you if a linked API key has withdrawals enabled, or alert on errors
- **host_permissions (exchange API domains)** — required to call the exchange's REST API directly from your browser

TRODO does not request access to your browsing history, other tabs, or any
site you visit.

## Your control over your data

- Remove a linked account any time from Settings → Linked accounts → Remove. This deletes the account's encrypted secret from local storage immediately.
- Uninstalling the extension deletes all locally stored data, since nothing is stored elsewhere.
- Revoking or deleting the API key on the exchange itself immediately cuts off TRODO's access, independent of anything in the extension.

## Contact

Questions about this policy or how TRODO handles data can be sent to:
`[your contact email here]`
