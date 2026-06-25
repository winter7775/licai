import { describe, expect, it } from "vitest";
import type { PositionStatus, RuleResult } from "./types";
import {
  applyPaperTrade,
  createInitialPaperAccount,
  generatePaperTradingPlan,
  summarizePaperAccount,
  type PaperCandidate
} from "./paperTrading";

const normalPosition = {
  band: { min: 35, max: 60 },
  finalGate: {
    gate: "normal",
    label: "正常开仓",
    reason: "市场允许开新仓",
    min: 35,
    max: 60,
    riskMultiplier: 1
  }
} as PositionStatus;

const blockedPosition = {
  band: { min: 0, max: 0 },
  finalGate: {
    gate: "blocked",
    label: "禁止开新仓",
    reason: "市场情绪红灯",
    min: 0,
    max: 0,
    riskMultiplier: 0
  }
} as PositionStatus;

const defensiveBandPosition = {
  band: { min: 25, max: 35 },
  finalGate: {
    gate: "watch_only",
    label: "防守观察",
    reason: "组合仓位上限仅 35.0%，只允许观察，不主动开新仓。",
    min: 25,
    max: 35,
    riskMultiplier: 0
  }
} as PositionStatus;

function candidate(overrides: Partial<PaperCandidate> = {}): PaperCandidate {
  return {
    symbol: "600879",
    name: "航天电子",
    industry: "军工电子",
    price: 20,
    signalType: "breakout",
    score: 80,
    stopPrice: 18.8,
    takeProfitPrice: 28,
    suggestedPositionPct: 10,
    hardRulesPassed: true,
    reason: "平台突破信号",
    ...overrides
  };
}

function rule(id: string, passed: boolean, actual: string | number = passed ? "ok" : "fail", severity: RuleResult["severity"] = "soft"): RuleResult {
  return {
    id,
    name: id,
    actual,
    threshold: "test",
    passed,
    severity
  };
}

function trialCandidate(overrides: Partial<PaperCandidate> = {}): PaperCandidate {
  return candidate({
    symbol: "603259",
    name: "药明康德",
    signalType: "watch",
    score: 78,
    suggestedPositionPct: 0,
    hardRulesPassed: true,
    rules: [
      rule("liquidity.prefilter", true, "ok", "hard"),
      rule("trend.template", true, "ok", "hard"),
      rule("quality.valuation", true, "PE TTM 42", "hard"),
      rule("relative_strength", true, "RS20 1% / RS60 2%", "hard"),
      rule("base.range", true),
      rule("base.volume_contraction", true),
      rule("base.atr_contraction", true),
      rule("base.volatility_contraction", true),
      rule("buy.breakout", false, "偏离-6.44% / 量比0.97", "info"),
      rule("risk.stop_loss_width", true, 7, "hard")
    ],
    reason: "B级试错候选",
    ...overrides
  });
}

describe("paper trading account", () => {
  it("starts with 200000 CNY virtual cash and no holdings", () => {
    const account = createInitialPaperAccount("2026-06-09T09:30:00.000Z");

    expect(account.initialCapital).toBe(200000);
    expect(account.cash).toBe(200000);
    expect(account.holdings).toEqual([]);
    expect(account.trades).toEqual([]);
  });

  it("marks holdings to market and reports return and exposure", () => {
    const account = applyPaperTrade(createInitialPaperAccount("2026-06-09T09:30:00.000Z"), {
      side: "buy",
      symbol: "600879",
      name: "航天电子",
      industry: "军工电子",
      quantity: 1000,
      price: 20,
      stopPrice: 18.8,
      takeProfitPrice: 28,
      reason: "测试买入",
      tradedAt: "2026-06-09T10:00:00.000Z"
    });

    const summary = summarizePaperAccount(account, { "600879": 22 });

    expect(summary.cash).toBe(180000);
    expect(summary.marketValue).toBe(22000);
    expect(summary.totalAssets).toBe(202000);
    expect(summary.totalReturnPct).toBe(1);
    expect(summary.exposurePct).toBe(10.89);
    expect(summary.holdings[0].unrealizedPnl).toBe(2000);
  });

  it("updates cash, average cost, and ledger when applying buys and sells", () => {
    const bought = applyPaperTrade(createInitialPaperAccount("2026-06-09T09:30:00.000Z"), {
      side: "buy",
      symbol: "600879",
      name: "航天电子",
      industry: "军工电子",
      quantity: 1000,
      price: 20,
      stopPrice: 18.8,
      takeProfitPrice: 28,
      reason: "测试买入",
      tradedAt: "2026-06-09T10:00:00.000Z"
    });

    const sold = applyPaperTrade(bought, {
      side: "sell",
      symbol: "600879",
      name: "航天电子",
      industry: "军工电子",
      quantity: 400,
      price: 22,
      reason: "测试卖出",
      tradedAt: "2026-06-10T10:00:00.000Z"
    });

    expect(sold.cash).toBe(188800);
    expect(sold.holdings[0].quantity).toBe(600);
    expect(sold.holdings[0].avgCost).toBe(20);
    expect(sold.trades).toHaveLength(2);
    expect(sold.trades[1]).toMatchObject({ side: "sell", quantity: 400, amount: 8800, realizedPnl: 800, realizedPnlPct: 10 });
  });
});

describe("paper trading auto plan", () => {
  it("does not open new positions when the market gate blocks entries", () => {
    const result = generatePaperTradingPlan({
      account: createInitialPaperAccount("2026-06-09T09:30:00.000Z"),
      candidates: [candidate()],
      position: blockedPosition,
      tradedAt: "2026-06-09T15:10:00.000Z"
    });

    expect(result.trades).toEqual([]);
    expect(result.account.updatedAt).toBe("2026-06-09T15:10:00.000Z");
    expect(result.review.actionSummary).toContain("未开新仓");
    expect(result.review.decisions[0]).toContain("禁止开新仓");
  });

  it("buys qualified full-market candidates within the market exposure cap", () => {
    const result = generatePaperTradingPlan({
      account: createInitialPaperAccount("2026-06-09T09:30:00.000Z"),
      candidates: [candidate({ symbol: "600879", price: 20, suggestedPositionPct: 10 })],
      position: normalPosition,
      tradedAt: "2026-06-09T15:10:00.000Z"
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ side: "buy", symbol: "600879", quantity: 1000, price: 20 });
    expect(result.account.cash).toBe(180000);
    expect(result.review.actionSummary).toContain("买入 1 笔");
  });

  it("buys for the paper account when its own exposure is below a defensive target band", () => {
    const result = generatePaperTradingPlan({
      account: createInitialPaperAccount("2026-06-09T09:30:00.000Z"),
      candidates: [
        candidate({ symbol: "600879", score: 90 }),
        candidate({ symbol: "600880", score: 85 }),
        candidate({ symbol: "600881", score: 80 }),
        candidate({ symbol: "600882", score: 75 })
      ],
      position: defensiveBandPosition,
      tradedAt: "2026-06-09T15:10:00.000Z"
    });

    const summary = summarizePaperAccount(result.account, {
      "600879": 20,
      "600880": 20,
      "600881": 20,
      "600882": 20
    });

    expect(result.trades.length).toBeGreaterThan(0);
    expect(summary.exposurePct).toBeGreaterThanOrEqual(25);
    expect(summary.exposurePct).toBeLessThanOrEqual(35);
  });

  it("ignores watch candidates and candidates with failed hard rules", () => {
    const result = generatePaperTradingPlan({
      account: createInitialPaperAccount("2026-06-09T09:30:00.000Z"),
      candidates: [
        candidate({ symbol: "600001", signalType: "watch" }),
        candidate({ symbol: "600002", hardRulesPassed: false })
      ],
      position: normalPosition,
      tradedAt: "2026-06-09T15:10:00.000Z"
    });

    expect(result.trades).toEqual([]);
    expect(result.review.actionSummary).toContain("无新增交易");
    expect(result.review.decisions).toContain("本轮没有符合硬性交易规则的标的，未强行建仓。");
  });

  it("opens small B-grade trial positions when only the buy confirmation is missing", () => {
    const nearBreakoutRules = trialCandidate().rules?.map((item) =>
      item.id === "buy.breakout" ? { ...item, actual: "偏离-1.2% / 量比0.97" } : item
    );

    const result = generatePaperTradingPlan({
      account: createInitialPaperAccount("2026-06-09T09:30:00.000Z"),
      candidates: [trialCandidate({ price: 20, rules: nearBreakoutRules })],
      position: defensiveBandPosition,
      tradedAt: "2026-06-09T15:10:00.000Z"
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ side: "buy", symbol: "603259", quantity: 300, price: 20 });
    expect(result.trades[0].reason).toContain("B级试错");
    expect(summarizePaperAccount(result.account, { "603259": 20 }).exposurePct).toBe(3);
  });

  it("explains why a B-grade trial candidate was not bought", () => {
    const nearBreakoutRules = trialCandidate().rules?.map((item) =>
      item.id === "buy.breakout" ? { ...item, actual: "偏离-1.2% / 量比0.97" } : item
    );

    const result = generatePaperTradingPlan({
      account: createInitialPaperAccount("2026-06-09T09:30:00.000Z"),
      candidates: [trialCandidate({ symbol: "600777", price: 90, rules: nearBreakoutRules })],
      position: defensiveBandPosition,
      tradedAt: "2026-06-09T15:10:00.000Z"
    });

    expect(result.trades).toEqual([]);
    expect(result.candidateDecisions[0]).toMatchObject({
      symbol: "600777",
      grade: "B",
      action: "skip",
      reason: "不足一手"
    });
  });

  it("does not use B-grade trial entries when the setup is far below pivot and weak volume", () => {
    const weakRules = trialCandidate().rules?.map((item) =>
      item.id === "buy.breakout" ? { ...item, actual: "偏离-14.27% / 量比0.63" } : item
    );

    const result = generatePaperTradingPlan({
      account: createInitialPaperAccount("2026-06-09T09:30:00.000Z"),
      candidates: [trialCandidate({ rules: weakRules })],
      position: defensiveBandPosition,
      tradedAt: "2026-06-09T15:10:00.000Z"
    });

    expect(result.trades).toEqual([]);
  });

  it("does not use B-grade trial entries when the setup is still seven percent below pivot", () => {
    const farBelowRules = trialCandidate().rules?.map((item) =>
      item.id === "buy.breakout" ? { ...item, actual: "偏离-7.01% / 量比0.99" } : item
    );

    const result = generatePaperTradingPlan({
      account: createInitialPaperAccount("2026-06-09T09:30:00.000Z"),
      candidates: [trialCandidate({ rules: farBelowRules })],
      position: defensiveBandPosition,
      tradedAt: "2026-06-09T15:10:00.000Z"
    });

    expect(result.trades).toEqual([]);
  });

  it("does not use B-grade trial entries when relative strength is weak", () => {
    const weakRsRules = trialCandidate().rules?.map((item) =>
      item.id === "relative_strength"
        ? { ...item, passed: false, actual: "RS20 -3% / RS60 -5%" }
        : item.id === "buy.breakout"
          ? { ...item, actual: "偏离-1.2% / 量比0.97" }
          : item
    );

    const result = generatePaperTradingPlan({
      account: createInitialPaperAccount("2026-06-09T09:30:00.000Z"),
      candidates: [trialCandidate({ rules: weakRsRules })],
      position: defensiveBandPosition,
      tradedAt: "2026-06-09T15:10:00.000Z"
    });

    expect(result.trades).toEqual([]);
  });

  it("caps B-grade trial exposure at ten percent even with many trial candidates", () => {
    const nearBreakoutRules = trialCandidate().rules?.map((item) =>
      item.id === "buy.breakout" ? { ...item, actual: "偏离-1.2% / 量比0.97" } : item
    );
    const result = generatePaperTradingPlan({
      account: createInitialPaperAccount("2026-06-09T09:30:00.000Z"),
      candidates: Array.from({ length: 8 }, (_, index) =>
        trialCandidate({ symbol: String(600100 + index), price: 20, score: 90 - index, rules: nearBreakoutRules })
      ),
      position: normalPosition,
      tradedAt: "2026-06-09T15:10:00.000Z"
    });
    const quotes = Object.fromEntries(result.account.holdings.map((holding) => [holding.symbol, 20]));
    const summary = summarizePaperAccount(result.account, quotes);

    expect(result.trades.length).toBeGreaterThan(0);
    expect(summary.exposurePct).toBeLessThanOrEqual(10);
  });

  it("sells holdings that hit stop loss or take profit before considering new buys", () => {
    const account = applyPaperTrade(createInitialPaperAccount("2026-06-09T09:30:00.000Z"), {
      side: "buy",
      symbol: "600879",
      name: "航天电子",
      industry: "军工电子",
      quantity: 1000,
      price: 20,
      stopPrice: 18.8,
      takeProfitPrice: 28,
      reason: "测试买入",
      tradedAt: "2026-06-09T10:00:00.000Z"
    });

    const result = generatePaperTradingPlan({
      account,
      candidates: [candidate({ symbol: "600879", price: 28.5 })],
      position: normalPosition,
      tradedAt: "2026-06-10T15:10:00.000Z"
    });

    expect(result.trades[0]).toMatchObject({ side: "sell", symbol: "600879", quantity: 1000, price: 28.5 });
    expect(result.account.holdings).toEqual([]);
  });
});
