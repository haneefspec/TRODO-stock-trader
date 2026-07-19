import { decryptSecret, encryptSecret, makeVerifier } from "./lib/crypto.js";
import * as binance from "./lib/binanceClient.js";
import * as groww from "./lib/growwClient.js";
import { RiskManager } from "./lib/riskManager.js";
import { trendFollowingSignal, gridSignal } from "./lib/strategies.js";

// Groww access tokens are minted from an API key/secret once and are valid for
// the rest of the day — cache them per-account in the (in-memory, per-session)
// service worker scope instead of re-minting one on every alarm tick.
const growwTokenCache = new Map(); // accountId -> { token, expiry }

async function getGrowwAccessToken(account, apiKey, apiSecret) {
  const cached = growwTokenCache.get(account.id);
  if (cached && (!cached.expiry || new Date(cached.expiry).getTime() > Date.now())) {
    return cached.token;
  }
  const { token, expiry } = await groww.getAccessToken({ apiKey, apiSecret });
  growwTokenCache.set(account.id, { token, expiry });
  return token;
}

const ALARM_NAME = "trodo-strategy-tick";
const TICK_MINUTES = 5;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "trodo:create-vault") {
    makeVerifier(message.passphrase).then(async (verifier) => {
      await chrome.storage.local.set({ trodo_vault_verifier: verifier });
      sendResponse({ ok: true });
    });
    return true; // async response
  }

  if (message.type === "trodo:save-account") {
    saveAccount(message.passphrase, message.account).then((account) => sendResponse({ ok: true, account }));
    return true;
  }

  if (message.type === "trodo:delete-account") {
    deleteAccount(message.accountId).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function saveAccount(passphrase, accountInput) {
  const { trodo_accounts = [] } = await chrome.storage.local.get("trodo_accounts");
  const encryptedSecret = await encryptSecret(passphrase, accountInput.apiSecret);
  const account = {
    id: accountInput.id || crypto.randomUUID(),
    label: accountInput.label,
    broker: accountInput.broker || "binance", // "binance" | "groww"
    assetMode: accountInput.assetMode || "trading", // "trading" | "portfolio_view"
    apiKey: accountInput.apiKey,
    encryptedSecret,
    network: accountInput.network,
    symbol: accountInput.symbol,
    exchange: accountInput.exchange, // Groww only: "NSE" | "BSE"
    segment: accountInput.segment, // Groww only: "CASH" | "FNO"
    product: accountInput.product, // Groww only: "CNC" | "MIS" | ...
    strategy: accountInput.strategy,
    gridConfig: accountInput.gridConfig,
    riskSettings: accountInput.riskSettings,
    // autoExecute is only ever honored for assetMode "trading" — see runAccount().
    // portfolio_view accounts (mutual funds / passive holdings) never place orders,
    // regardless of this flag, so a stray "true" here can't cause a trade.
    autoExecute: !!accountInput.autoExecute,
    // Required, user-checked acknowledgement before TRODO will auto-execute live
    // orders through Groww — see options.html. Not required for Binance (crypto
    // spot has no equivalent India-specific algo-trading regulatory surface) or
    // for portfolio_view accounts (which never execute).
    complianceAck: !!accountInput.complianceAck,
    enabled: true,
  };
  const existingIndex = trodo_accounts.findIndex((a) => a.id === account.id);
  if (existingIndex >= 0) trodo_accounts[existingIndex] = account;
  else trodo_accounts.push(account);
  await chrome.storage.local.set({ trodo_accounts });
  return account;
}

async function deleteAccount(accountId) {
  const { trodo_accounts = [] } = await chrome.storage.local.get("trodo_accounts");
  await chrome.storage.local.set({ trodo_accounts: trodo_accounts.filter((a) => a.id !== accountId) });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: TICK_MINUTES });
  console.log(`TRODO installed. Checking linked accounts every ${TICK_MINUTES} min while the browser is open.`);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runAllAccounts();
});

async function appendLog(entry) {
  const { trodo_logs = [] } = await chrome.storage.local.get("trodo_logs");
  trodo_logs.unshift({ ...entry, ts: Date.now() });
  await chrome.storage.local.set({ trodo_logs: trodo_logs.slice(0, 200) });
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
    });
  } catch {
    /* notifications permission may be off in some Chrome channels — logging still happens */
  }
}

async function runAllAccounts() {
  const { trodo_accounts = [], trodo_session } = await chrome.storage.local.get("trodo_accounts");
  const session = await chrome.storage.session.get("trodo_vault_passphrase");
  const passphrase = session.trodo_vault_passphrase;

  if (!passphrase) {
    // Vault is locked — nothing to decrypt, skip silently until the user unlocks it in the popup.
    return;
  }

  for (const account of trodo_accounts) {
    if (!account.enabled) continue;
    try {
      await runAccount(account, passphrase);
    } catch (err) {
      await appendLog({ accountId: account.id, level: "error", message: err.message });
    }
  }
}

async function runAccount(account, passphrase) {
  const apiSecret = await decryptSecret(passphrase, account.encryptedSecret);
  const broker = account.broker || "binance";

  // --- 1. Read a snapshot, broker-specific -------------------------------
  const snapshot = await getSnapshotForBroker(account, apiSecret);
  if (snapshot.canWithdraw) {
    await notify(
      "TRODO security warning",
      `The API key for "${account.label}" has withdrawal permission enabled. Disable it on the exchange — TRODO never needs it.`
    );
  }

  const portfolioValue = snapshot.balances.reduce((sum, b) => sum + b.free + b.locked, 0); // simplistic; real version should price each asset

  // --- 2. portfolio_view accounts stop here — read-only, always -----------
  // Mutual funds and other passive holdings are logged for visibility, but
  // TRODO never runs a strategy or places an order for them. This isn't a UI
  // toggle a stray click can flip — it's a code-level branch, so there is no
  // path from "portfolio_view" to placeOrder() in this function at all.
  if ((account.assetMode || "trading") === "portfolio_view") {
    await appendLog({
      accountId: account.id,
      level: "info",
      message: `[portfolio view] ${snapshot.balances.length} holding(s), approx value ${portfolioValue.toFixed(2)}. Read-only — no strategy runs, no orders placed.`,
    });
    return;
  }

  // --- 3. Trading accounts: compute a signal ------------------------------
  const risk = new RiskManager(account.riskSettings);
  risk.updateEquity(portfolioValue || 1);

  const price = await getPriceForBroker(account, apiSecret);
  let signal;

  if (account.strategy === "grid") {
    signal = gridSignal(price, account.gridConfig);
  } else if (account.strategy === "trend") {
    if (broker === "groww") {
      // Groww's Trading API doesn't expose historical candles the same way this
      // build wires up; trend-following is Binance-only for now.
      signal = { action: "HOLD", reason: "Trend-following isn't wired up for Groww in this build — use grid or arbitrage-scan." };
    } else {
      const candles = await binance.getKlines(account.symbol, "1h", 100, account.network || "testnet");
      signal = trendFollowingSignal(candles);
    }
  } else {
    signal = { action: "HOLD", reason: "Arbitrage strategy is scan-only in this build." };
  }

  await appendLog({ accountId: account.id, level: "info", message: `[${account.symbol}] ${signal.action}: ${signal.reason}` });

  if (signal.action === "HOLD" || !account.autoExecute) return;

  // --- 4. Compliance gate for Groww auto-execute --------------------------
  // Placing live orders on a SEBI-regulated broker through an API carries
  // rules (and consequences) that a crypto testnet key doesn't. TRODO refuses
  // to place a Groww order unless the user has explicitly checked the
  // compliance acknowledgement in Settings for this account.
  if (broker === "groww" && !account.complianceAck) {
    await appendLog({
      accountId: account.id,
      level: "blocked",
      message: "Auto-execute is on but the Groww compliance acknowledgement isn't checked for this account — order was not placed. Open Settings to review and confirm it.",
    });
    return;
  }

  const proposedNotional = portfolioValue * ((signal.notionalPct || 5) / 100);
  const decision = risk.evaluateEntry({ portfolioValue, proposedNotional, price });

  if (!decision.allowed) {
    await appendLog({ accountId: account.id, level: "blocked", message: decision.reason });
    return;
  }

  const side = signal.action === "BUY" ? "BUY" : "SELL";
  const order = await placeOrderForBroker(account, apiSecret, { side, price, sizedQuantity: decision.sizedQuantity });

  await appendLog({ accountId: account.id, level: "trade", message: `${side} ${order.displayQuantity} ${account.symbol} — order ${order.orderId}` });
}

async function getSnapshotForBroker(account, apiSecret) {
  if ((account.broker || "binance") === "groww") {
    const accessToken = await getGrowwAccessToken(account, account.apiKey, apiSecret);
    return groww.getAccountSnapshot({ accessToken });
  }
  return binance.getAccountSnapshot({ apiKey: account.apiKey, apiSecret, network: account.network || "testnet" });
}

async function getPriceForBroker(account, apiSecret) {
  if ((account.broker || "binance") === "groww") {
    const accessToken = await getGrowwAccessToken(account, account.apiKey, apiSecret);
    return groww.getPrice(account.symbol, account.exchange || "NSE", account.segment || "CASH", accessToken);
  }
  return binance.getPrice(account.symbol, account.network || "testnet");
}

async function placeOrderForBroker(account, apiSecret, { side, price, sizedQuantity }) {
  if ((account.broker || "binance") === "groww") {
    const accessToken = await getGrowwAccessToken(account, account.apiKey, apiSecret);
    const quantity = Math.max(1, Math.floor(sizedQuantity)); // Groww equity orders are whole shares
    const order = await groww.placeOrder({
      accessToken,
      tradingSymbol: account.symbol,
      side,
      quantity,
      orderType: "MARKET",
      segment: account.segment || "CASH",
      product: account.product || "CNC",
      exchange: account.exchange || "NSE",
    });
    return { orderId: order.groww_order_id, displayQuantity: quantity };
  }

  const order = await binance.placeOrder({
    apiKey: account.apiKey,
    apiSecret,
    symbol: account.symbol,
    side,
    type: "MARKET",
    quantity: sizedQuantity.toFixed(6),
    network: account.network || "testnet",
  });
  return { orderId: order.orderId, displayQuantity: sizedQuantity.toFixed(6) };
}
