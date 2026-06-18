import { describe, expect, it } from "vitest";
import {
  calculatePositionSizePct,
  calculateStopLossWidthPct,
  calculateTakeProfitPlan,
  evaluateStopLossRule,
  scoreSignalRules
} from "./ruleEngine";

const signalWithAllPass = {
  rules: [
    { id: "market", name: "大盘开关", actual: "绿灯", threshold: "绿灯", passed: true },
    { id: "trend", name: "趋势模板", actual: "MA20>MA60", threshold: "通过", passed: true },
    { id: "platform", name: "平台宽度", actual: 6.2, threshold: "<= 12%", passed: true }
  ]
};

describe("rule engine", () => {
  it("calculates stop-loss width as entry-to-stop percentage", () => {
    expect(calculateStopLossWidthPct(20, 18.8)).toBeCloseTo(6);
  });

  it("fails stop-loss rule when width is above seven percent", () => {
    const result = evaluateStopLossRule(20, 18.2);

    expect(result.passed).toBe(false);
    expect(result.actual).toBeCloseTo(9);
    expect(result.threshold).toBe("<= 7%");
  });

  it("fails stop-loss rule when the stop is not below the entry", () => {
    const result = evaluateStopLossRule(20, 20.5);

    expect(result.passed).toBe(false);
    expect(result.explanation).toContain("低于入场价");
  });

  it("builds the forty percent main take-profit plan", () => {
    expect(calculateTakeProfitPlan(20).mainTarget).toBe(28);
    expect(calculateTakeProfitPlan(20).partialSellPct).toBe(70);
  });

  it("caps single-stock position by risk and system max", () => {
    expect(
      calculatePositionSizePct({
        accountRiskPct: 1,
        stopLossWidthPct: 6,
        maxSinglePositionPct: 12,
        riskMultiplier: 1
      })
    ).toBe(12);

    expect(
      calculatePositionSizePct({
        accountRiskPct: 1,
        stopLossWidthPct: 6,
        maxSinglePositionPct: 12,
        riskMultiplier: 0.5
      })
    ).toBeCloseTo(8.33);
  });

  it("scores rule pass counts", () => {
    const score = scoreSignalRules(signalWithAllPass);

    expect(score.passedCount).toBe(signalWithAllPass.rules.length);
    expect(score.totalCount).toBe(signalWithAllPass.rules.length);
    expect(score.passRate).toBe(100);
  });
});
