// lib/growwClient.js
// Thin wrapper around Groww's official Trading API (https://groww.in/trade-api/docs).
// Requires an active "Trading APIs" subscription on the user's Groww account and an
// API key + secret generated from https://groww.in/trade-api/api-keys.
//
// Groww's key/secret flow needs a daily access token exchange (the key/secret pair
// itself is never sent on every call — only used once per day to mint a token).
// TRODO never asks for the Groww account password, and there is no "withdrawals"
// toggle to worry about here the way there is on crypto exchanges — Groww API keys
// only ever place/manage orders and read account data, they can't move money out.
//
// Coverage note: Groww's Trading API currently supports equity (CASH) and
// derivatives (FNO) order placement only — it has no order-placement endpoint for
// mutual funds. That's part of why "portfolio_view" mode (see background.js) never
// calls placeOrder: for mutual fund / passive holdings this client is used strictly
// to read and display a snapshot, never to trade.

const BASE = "https://api.groww.in/v1";
const API_VERSION = "1.0";

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function authHeaders(accessToken, extra = {}) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    "X-API-VERSION": API_VERSION,
    ...extra,
  };
}

/**
 * Exchanges an API key + secret for a same-day access token.
 * Groww access tokens expire daily at 6:00 AM IST, so callers should cache the
 * token (e.g. in chrome.storage.session) rather than minting a new one per call.
 */
export async function getAccessToken({ apiKey, apiSecret }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const checksum = await sha256Hex(apiSecret + timestamp);

  const res = await fetch("https://api.groww.in/v1/token/api/access", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key_type: "approval", checksum, timestamp }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groww token exchange failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return { token: data.token, expiry: data.expiry };
}

async function growwGet(accessToken, path) {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders(accessToken) });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.status === "FAILURE") {
    throw new Error(`Groww GET ${path} failed: ${data?.error?.message || res.status}`);
  }
  return data.payload;
}

async function growwPost(accessToken, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.status === "FAILURE") {
    throw new Error(`Groww POST ${path} failed: ${data?.error?.message || res.status}`);
  }
  return data.payload;
}

/**
 * Read-only holdings snapshot (demat holdings — stocks/ETFs). There is no
 * withdrawal/canTrade-style flag to check here; Groww API keys can only place
 * orders and read data, never move funds, so there's nothing to warn about there.
 */
export async function getAccountSnapshot({ accessToken }) {
  const payload = await growwGet(accessToken, "/holdings/user");
  const balances = (payload.holdings || []).map((h) => ({
    asset: h.trading_symbol,
    free: (h.demat_free_quantity ?? h.quantity) || 0,
    locked: (h.pledge_quantity || 0) + (h.demat_locked_quantity || 0),
  }));
  return {
    canTrade: true,
    canWithdraw: false, // not applicable to Groww API keys — kept for shape parity with binanceClient
    balances,
    updatedAt: Date.now(),
  };
}

/** Latest traded price for a single NSE/BSE instrument. */
export async function getPrice(tradingSymbol, exchange = "NSE", segment = "CASH", accessToken) {
  const exchangeSymbol = `${exchange}_${tradingSymbol}`;
  const payload = await growwGet(
    accessToken,
    `/live-data/ltp?segment=${segment}&exchange_symbols=${encodeURIComponent(exchangeSymbol)}`
  );
  const price = payload[exchangeSymbol];
  if (price == null) throw new Error(`No LTP returned for ${exchangeSymbol}`);
  return price;
}

/** Places an equity (CASH) or derivatives (FNO) order. Guarded by riskManager before this is called. */
export async function placeOrder({
  accessToken,
  tradingSymbol,
  side, // "BUY" | "SELL"
  quantity,
  price = 0,
  orderType = "MARKET",
  segment = "CASH",
  product = "CNC",
  validity = "DAY",
  exchange = "NSE",
}) {
  const orderReferenceId = `trodo-${Date.now()}`.slice(0, 20);
  return growwPost(accessToken, "/order/create", {
    trading_symbol: tradingSymbol,
    quantity,
    price,
    validity,
    exchange,
    segment,
    product,
    order_type: orderType,
    transaction_type: side,
    order_reference_id: orderReferenceId,
  });
}
