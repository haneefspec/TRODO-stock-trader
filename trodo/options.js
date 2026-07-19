const form = document.getElementById("accountForm");
const brokerSelect = document.getElementById("broker");
const assetModeSelect = document.getElementById("assetMode");
const strategySelect = document.getElementById("strategy");
const gridFields = document.getElementById("gridFields");
const growwFields = document.getElementById("growwFields");
const networkField = document.getElementById("networkField");
const symbolField = document.getElementById("symbolField");
const strategyField = document.getElementById("strategyField");
const riskExecuteSection = document.getElementById("riskExecuteSection");
const portfolioViewNote = document.getElementById("portfolioViewNote");
const growwComplianceGate = document.getElementById("growwComplianceGate");
const autoExecuteCheckbox = document.getElementById("autoExecute");
const complianceAckCheckbox = document.getElementById("complianceAck");
const accountsTable = document.getElementById("accountsTable");

function updateConditionalFields() {
  const broker = brokerSelect.value;
  const assetMode = assetModeSelect.value;
  const isGroww = broker === "groww";
  const isPortfolioView = assetMode === "portfolio_view";

  growwFields.style.display = isGroww ? "block" : "none";
  networkField.style.display = isGroww ? "none" : "block"; // Groww API has no testnet
  symbolField.querySelector("input").placeholder = isGroww ? "RELIANCE" : "BTCUSDT";

  // Portfolio-view accounts never run a strategy or place an order, so hide the
  // controls that only matter to a trading account rather than leave them
  // sitting there implying they do something.
  strategyField.style.display = isPortfolioView ? "none" : "block";
  riskExecuteSection.style.display = isPortfolioView ? "none" : "block";
  portfolioViewNote.hidden = !isPortfolioView;

  gridFields.style.display = !isPortfolioView && strategySelect.value === "grid" ? "block" : "none";
  growwComplianceGate.style.display = isGroww && !isPortfolioView ? "block" : "none";
}

brokerSelect.addEventListener("change", updateConditionalFields);
assetModeSelect.addEventListener("change", updateConditionalFields);
strategySelect.addEventListener("change", updateConditionalFields);
updateConditionalFields();

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const broker = brokerSelect.value;
  const assetMode = assetModeSelect.value;
  const autoExecute = assetMode === "trading" && autoExecuteCheckbox.checked;

  // Belt-and-suspenders: the same check lives in background.js before any order
  // is placed, but failing fast here saves the user a trip to the activity log.
  if (broker === "groww" && assetMode === "trading" && autoExecute && !complianceAckCheckbox.checked) {
    alert("Check the Groww compliance acknowledgement before enabling auto-execute for a Groww account.");
    return;
  }

  const account = {
    label: document.getElementById("label").value.trim(),
    broker,
    assetMode,
    network: document.getElementById("network").value,
    apiKey: document.getElementById("apiKey").value.trim(),
    apiSecret: document.getElementById("apiSecret").value,
    symbol: document.getElementById("symbol").value.trim().toUpperCase(),
    exchange: document.getElementById("growwExchange").value,
    segment: document.getElementById("growwSegment").value,
    product: document.getElementById("growwProduct").value,
    strategy: strategySelect.value,
    gridConfig: {
      centerPrice: parseFloat(document.getElementById("gridCenter").value) || 0,
      gridSpacingPct: parseFloat(document.getElementById("gridSpacing").value) || 1,
      levels: parseInt(document.getElementById("gridLevels").value, 10) || 4,
    },
    riskSettings: {
      maxPositionPct: parseFloat(document.getElementById("maxPositionPct").value),
      stopLossPct: parseFloat(document.getElementById("stopLossPct").value),
      trailingStopPct: parseFloat(document.getElementById("trailingStopPct").value),
      maxDailyDrawdownPct: parseFloat(document.getElementById("maxDailyDrawdownPct").value),
      maxOpenPositions: parseInt(document.getElementById("maxOpenPositions").value, 10),
    },
    autoExecute,
    complianceAck: broker === "groww" ? complianceAckCheckbox.checked : false,
  };

  const passphrase = document.getElementById("vaultPassphrase").value;

  const { trodo_vault_verifier } = await chrome.storage.local.get("trodo_vault_verifier");
  if (!trodo_vault_verifier) {
    await chrome.runtime.sendMessage({ type: "trodo:create-vault", passphrase });
  }

  const response = await chrome.runtime.sendMessage({ type: "trodo:save-account", passphrase, account });
  if (response?.ok) {
    form.reset();
    updateConditionalFields();
    await renderAccounts();
    alert(`Saved "${account.label}". It will be checked every few minutes while Chrome is open.`);
  } else {
    alert("Couldn't save the account. Check the console for details.");
  }
});

async function renderAccounts() {
  const { trodo_accounts = [] } = await chrome.storage.local.get("trodo_accounts");
  accountsTable.innerHTML = "";

  if (trodo_accounts.length === 0) {
    accountsTable.innerHTML = `<p class="empty-state">No accounts linked yet.</p>`;
    return;
  }

  for (const account of trodo_accounts) {
    const row = document.createElement("div");
    row.className = "account-row";
    const isPortfolioView = account.assetMode === "portfolio_view";
    const modeLabel = isPortfolioView
      ? "portfolio view (read-only)"
      : account.autoExecute
      ? "auto-execute on"
      : "signals only";
    const brokerLabel = account.broker === "groww" ? "Groww" : "Binance";
    row.innerHTML = `
      <div>
        <div>${account.label}</div>
        <div class="account-row__meta">${brokerLabel} · ${account.symbol} · ${isPortfolioView ? "portfolio view" : account.strategy} · ${account.network || "—"} · ${modeLabel}</div>
      </div>
      <button class="btn btn--danger" data-id="${account.id}">Remove</button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "trodo:delete-account", accountId: account.id });
      renderAccounts();
    });
    accountsTable.appendChild(row);
  }
}

renderAccounts();
