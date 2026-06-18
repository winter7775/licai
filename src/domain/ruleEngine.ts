import { defaultStrategyParams } from "./strategyParams";
import type { RuleResult, RuleScore } from "./types";

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export function calculateStopLossWidthPct(entryPrice: number, stopPrice: number): number {
  if (entryPrice <= 0) {
    throw new Error("entryPrice must be greater than zero");
  }

  return round(((entryPrice - stopPrice) / entryPrice) * 100);
}

export function evaluateStopLossRule(
  entryPrice: number,
  stopPrice: number,
  maxStopLossPct = defaultStrategyParams.stock.maxStopLossPct
): RuleResult {
  const width = calculateStopLossWidthPct(entryPrice, stopPrice);
  const validDirection = stopPrice < entryPrice;
  return {
    id: "risk.stop_loss_width",
    name: "止损幅度",
    actual: width,
    threshold: `<= ${maxStopLossPct}%`,
    passed: validDirection && width <= maxStopLossPct,
    severity: "hard",
    explanation: !validDirection
      ? "止损价必须低于入场价，该风险结构无效。"
      : width <= maxStopLossPct
        ? "止损距离在系统上限内。"
        : "信号有效但止损过宽，不允许买入。"
  };
}

export function calculateTakeProfitPlan(
  entryPrice: number,
  takeProfitPct = defaultStrategyParams.stock.mainTakeProfitPct
): {
  mainTarget: number;
  partialSellPct: number;
  breakEvenStopAfterPct: number;
  trailStopPct: number;
} {
  return {
    mainTarget: round(entryPrice * (1 + takeProfitPct / 100)),
    partialSellPct: 70,
    breakEvenStopAfterPct: 15,
    trailStopPct: 10
  };
}

export function calculatePositionSizePct(input: {
  accountRiskPct: number;
  stopLossWidthPct: number;
  maxSinglePositionPct: number;
  riskMultiplier: number;
}): number {
  if (input.stopLossWidthPct <= 0 || input.riskMultiplier <= 0) {
    return 0;
  }

  const riskBasedPosition = (input.accountRiskPct * input.riskMultiplier * 100) / input.stopLossWidthPct;
  return round(Math.min(input.maxSinglePositionPct, riskBasedPosition));
}

export function scoreSignalRules(signal: { rules: Array<Pick<RuleResult, "passed">> }): RuleScore {
  const totalCount = signal.rules.length;
  const passedCount = signal.rules.filter((rule) => rule.passed).length;

  return {
    passedCount,
    totalCount,
    passRate: totalCount === 0 ? 0 : round((passedCount / totalCount) * 100, 1)
  };
}
