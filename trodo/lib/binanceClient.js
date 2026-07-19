// lib/binanceClient.js
// Thin wrapper around Binance's public, documented REST API.
// TRODO never asks for or stores account passwords — only an API key/secret
// pair that the user generates on the exchange with "Enable Spot & Margin
// Trading" turned ON and "Enable Withdrawals" turned OFF.

// check the ccomments once
const HOSTS = {
  live: "https://api.binance.com",
  testnet: "https://testnet.binance.vision",
};

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

async function signedRequest({ apiKey, apiSecret, path, method = "GET", params = {}, network = "testnet" }) {
  const host = HOSTS[network] || HOSTS.testnet;
  const query = buildQuery({ ...params, timestamp: Date.now(), recvWindow: 5000 });
  const signature = await hmacSha256Hex(apiSecret, query);
  const url = `${host}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": apiKey },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance ${method} ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

/** Read-only: balances, permissions, whether withdrawals are (correctly) disabled. */
export async function getAccountSnapshot({ apiKey, apiSecret, network = "testnet" }) {
  const account = await signedRequest({
    apiKey,
    apiSecret,
    path: "/api/v3/account",
    network,
  });

  const balances = (account.balances || [])
    .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
    .map((b) => ({ asset: b.asset, free: parseFloat(b.free), locked: parseFloat(b.locked) }));

  return {
    canTrade: account.canTrade,
    canWithdraw: account.canWithdraw, // TRODO warns the user in the UI if this is true
    canDeposit: account.canDeposit,
    balances,
    updatedAt: Date.now(),
  };
}

/** Public endpoint, no signing needed. */
export async function getPrice(symbol, network = "testnet") {
  const host = HOSTS[network] || HOSTS.testnet;
  const res = await fetch(`${host}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`Price lookup failed for ${symbol}`);
  const data = await res.json();
  return parseFloat(data.price);
}

/** Public candles for backtesting / indicator calculation. */
export async function getKlines(symbol, interval = "1h", limit = 200, network = "testnet") {
  const host = HOSTS[network] || HOSTS.testnet;
  const url = `${host}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Klines lookup failed for ${symbol}`);
  const raw = await res.json();
  return raw.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

/** Places a market or limit order. Guarded by riskManager before this is ever called. */
export async function placeOrder({ apiKey, apiSecret, symbol, side, type = "MARKET", quantity, price, network = "testnet" }) {
  const params = { symbol, side, type, quantity };
  if (type === "LIMIT") {
    params.price = price;
    params.timeInForce = "GTC";
  }
  return signedRequest({
    apiKey,
    apiSecret,
    path: "/api/v3/order",
    method: "POST",
    params,
    network,
  });
}
