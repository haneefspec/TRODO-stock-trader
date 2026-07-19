// lib/strategies.js
// Each strategy takes market data and returns a proposed action:
//   { action: "BUY" | "SELL" | "HOLD", reason: string, notionalPct?: number }
// The caller (background.js) is responsible for running this through
// RiskManager.evaluateEntry() before anything reaches the exchange.

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = sma(values.slice(0, period), period);
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(values) {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  if (ema12 == null || ema26 == null) return null;
  return ema12 - ema26;
}

/** Trend-following: RSI oversold/overbought crossed with MACD confirmation. */
export function trendFollowingSignal(candles) {
  const closes = candles.map((c) => c.close);
  const r = rsi(closes, 14);
  const m = macd(closes);
  if (r == null || m == null) return { action: "HOLD", reason: "Not enough history yet." };

  if (r < 30 && m > 0) {
    return { action: "BUY", reason: `RSI oversold (${r.toFixed(1)}) with positive MACD momentum.`, notionalPct: 5 };
  }
  if (r > 70 && m < 0) {
    return { action: "SELL", reason: `RSI overbought (${r.toFixed(1)}) with negative MACD momentum.`, notionalPct: 5 };
  }
  return { action: "HOLD", reason: `RSI ${r.toFixed(1)}, MACD ${m.toFixed(4)} — no edge.` };
}

/** Grid trading: buy/sell against fixed price levels around a center price. */
export function gridSignal(currentPrice, gridConfig) {
  const { centerPrice, gridSpacingPct, levels } = gridConfig;
  const step = centerPrice * (gridSpacingPct / 100);

  for (let i = 1; i <= levels; i++) {
    const buyLevel = centerPrice - step * i;
    const sellLevel = centerPrice + step * i;
    if (Math.abs(currentPrice - buyLevel) / buyLevel < 0.001) {
      return { action: "BUY", reason: `Price touched grid buy level ${buyLevel.toFixed(2)}.`, notionalPct: 100 / (levels * 2) };
    }
    if (Math.abs(currentPrice - sellLevel) / sellLevel < 0.001) {
      return { action: "SELL", reason: `Price touched grid sell level ${sellLevel.toFixed(2)}.`, notionalPct: 100 / (levels * 2) };
    }
  }
  return { action: "HOLD", reason: "Price sitting between grid levels." };
}

/**
 * Arbitrage scan: compares the same symbol's price across two price feeds
 * (e.g. two exchanges, or spot vs. a second venue) and flags spreads above
 * a threshold. Execution across venues needs a second linked account —
 * this returns a signal, it does not place cross-venue orders itself.
 */
export function arbitrageSignal(priceA, priceB, feeSummaryPct = 0.2) {
  const spreadPct = ((priceB - priceA) / priceA) * 100;
  const netEdgePct = Math.abs(spreadPct) - feeSummaryPct;
  if (netEdgePct > 0.1) {
    return {
      action: spreadPct > 0 ? "BUY_A_SELL_B" : "BUY_B_SELL_A",
      reason: `Spread ${spreadPct.toFixed(3)}% exceeds round-trip fees (${feeSummaryPct}%).`,
      netEdgePct,
    };
  }
  return { action: "HOLD", reason: `Spread ${spreadPct.toFixed(3)}% doesn't clear fees.` };
}
