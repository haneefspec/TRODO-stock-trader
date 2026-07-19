// lib/riskManager.js
// Every trade proposed by a strategy passes through here before it is sent
// to the exchange. If any check fails, the trade is blocked and logged.

export const DEFAULT_RISK_SETTINGS = {
  maxPositionPct: 10,       // max % of portfolio in a single trade
  stopLossPct: 3,           // per-position stop loss
  trailingStopPct: 2,       // trailing stop once in profit
  maxDailyDrawdownPct: 5,   // halt trading for the day past this loss
  maxOpenPositions: 5,
};

export class RiskManager {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_RISK_SETTINGS, ...settings };
    this.dailyStartEquity = null;
    this.dailyPnlPct = 0;
    this.openPositions = 0;
  }

  startOfDay(equity) {
    this.dailyStartEquity = equity;
    this.dailyPnlPct = 0;
  }

  updateEquity(currentEquity) {
    if (this.dailyStartEquity == null) this.startOfDay(currentEquity);
    this.dailyPnlPct = ((currentEquity - this.dailyStartEquity) / this.dailyStartEquity) * 100;
  }

  /** Returns { allowed: bool, reason?: string, sizedQuantity?: number } */
  evaluateEntry({ portfolioValue, proposedNotional, price }) {
    if (this.dailyPnlPct <= -this.settings.maxDailyDrawdownPct) {
      return { allowed: false, reason: `Daily drawdown limit hit (${this.dailyPnlPct.toFixed(2)}%). Trading halted until reset.` };
    }
    if (this.openPositions >= this.settings.maxOpenPositions) {
      return { allowed: false, reason: `Max open positions (${this.settings.maxOpenPositions}) reached.` };
    }

    const maxNotional = portfolioValue * (this.settings.maxPositionPct / 100);
    const sizedNotional = Math.min(proposedNotional, maxNotional);
    const sizedQuantity = sizedNotional / price;

    if (sizedQuantity <= 0) {
      return { allowed: false, reason: "Sized quantity is zero after risk limits — portfolio too small for this position." };
    }

    return { allowed: true, sizedQuantity, sizedNotional };
  }

  computeStopPrice(entryPrice, side) {
    const pct = this.settings.stopLossPct / 100;
    return side === "BUY" ? entryPrice * (1 - pct) : entryPrice * (1 + pct);
  }

  computeTrailingStop(currentPrice, highWaterMark, side) {
    const pct = this.settings.trailingStopPct / 100;
    return side === "BUY" ? highWaterMark * (1 - pct) : highWaterMark * (1 + pct);
  }

  onPositionOpened() {
    this.openPositions += 1;
  }

  onPositionClosed() {
    this.openPositions = Math.max(0, this.openPositions - 1);
  }
}
