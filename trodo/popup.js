import { checkVerifier, decryptSecret } from "./lib/crypto.js";
import * as binance from "./lib/binanceClient.js";
import * as groww from "./lib/growwClient.js";

const vaultGate = document.getElementById("vaultGate");
const mainContent = document.getElementById("mainContent");
const vaultDot = document.getElementById("vaultDot");
const vaultLabel = document.getElementById("vaultLabel");
const passphraseInput = document.getElementById("passphraseInput");
const unlockBtn = document.getElementById("unlockBtn");
const accountList = document.getElementById("accountList");
const logList = document.getElementById("logList");

document.getElementById("addAccountBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
unlockBtn.addEventListener("click", unlock);
passphraseInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlock();
});

async function unlock() {
  const passphrase = passphraseInput.value;
  if (!passphrase) return;

  const { trodo_vault_verifier } = await chrome.storage.local.get("trodo_vault_verifier");
  if (!trodo_vault_verifier) {
    // No vault yet — first unlock attempt becomes the vault passphrase.
    await chrome.runtime.sendMessage({ type: "trodo:create-vault", passphrase });
  } else {
    const ok = await checkVerifier(passphrase, trodo_vault_verifier);
    if (!ok) {
      passphraseInput.value = "";
      passphraseInput.placeholder = "Wrong passphrase — try again";
      return;
    }
  }

  await chrome.storage.session.set({ trodo_vault_passphrase: passphrase });
  await render();
}

async function render() {
  const session = await chrome.storage.session.get("trodo_vault_passphrase");
  const unlocked = !!session.trodo_vault_passphrase;

  vaultGate.hidden = unlocked;
  mainContent.hidden = !unlocked;
  vaultDot.className = `dot ${unlocked ? "dot--unlocked" : "dot--locked"}`;
  vaultLabel.textContent = unlocked ? "Vault unlocked" : "Vault locked";

  if (!unlocked) return;

  const { trodo_accounts = [] } = await chrome.storage.local.get("trodo_accounts");
  accountList.innerHTML = "";

  if (trodo_accounts.length === 0) {
    accountList.innerHTML = `<div class="empty-state">No accounts linked yet. Use "+ Add" to link one with a trade-only API key.</div>`;
  }

  for (const account of trodo_accounts) {
    const isPortfolioView = account.assetMode === "portfolio_view";
    const brokerLabel = account.broker === "groww" ? "Groww" : "Binance";
    const networkBadge = account.broker === "groww" ? "live" : account.network || "testnet";
    const card = document.createElement("div");
    card.className = "account-card";
    card.innerHTML = `
      <div class="account-card__row">
        <span class="account-card__name">${account.label}</span>
        <span class="badge ${networkBadge === "live" ? "badge--live" : "badge--testnet"}">${networkBadge}</span>
      </div>
      <div class="account-card__symbol">${brokerLabel} · ${account.symbol}${isPortfolioView ? " · portfolio view" : ` · ${account.strategy}`}</div>
      <div class="account-card__balances" id="bal-${account.id}">Loading balances…</div>
    `;
    accountList.appendChild(card);
    loadBalances(account, session.trodo_vault_passphrase);
  }

  const { trodo_logs = [] } = await chrome.storage.local.get("trodo_logs");
  logList.innerHTML = "";
  if (trodo_logs.length === 0) {
    logList.innerHTML = `<div class="empty-state">No activity yet. Checks run every few minutes while the browser is open.</div>`;
  }
  for (const entry of trodo_logs.slice(0, 20)) {
    const div = document.createElement("div");
    div.className = `log-entry log-entry--${entry.level}`;
    const time = new Date(entry.ts).toLocaleTimeString();
    div.textContent = `${time} — ${entry.message}`;
    logList.appendChild(div);
  }
}

async function loadBalances(account, passphrase) {
  const el = document.getElementById(`bal-${account.id}`);
  try {
    const apiSecret = await decryptSecret(passphrase, account.encryptedSecret);
    const snapshot =
      account.broker === "groww"
        ? await groww.getAccountSnapshot({ accessToken: (await groww.getAccessToken({ apiKey: account.apiKey, apiSecret })).token })
        : await binance.getAccountSnapshot({ apiKey: account.apiKey, apiSecret, network: account.network || "testnet" });

    const top = snapshot.balances.slice(0, 3).map((b) => `${b.asset} ${(b.free + b.locked).toFixed(4)}`).join(" · ");
    el.textContent = top || "No non-zero balances";
    if (snapshot.canWithdraw) {
      el.textContent += " ⚠ withdrawals enabled on this key";
      el.style.color = "var(--warning)";
    }
  } catch (err) {
    el.textContent = `Couldn't fetch balances: ${err.message}`;
  }
}

render();
