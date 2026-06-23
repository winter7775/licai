import { describe, expect, it } from "vitest";
import { buildPaperAttribution, type PaperAttributionCandidate } from "./paperAttribution";
import type { RuleResult, SignalType } from "./types";

function rule(overrides: Partial<RuleResult> = {}): RuleResult {
  return {
    id: "buy.breakout",
    name: "breakout",
    actual: "extension 0%",
    threshold: "1%-7%",
    passed: false,
    severity: "hard",
    ...overrides
  };
}

function candidate(overrides: Partial<PaperAttributionCandidate> = {}): PaperAttributionCandidate {
  const signalType = overrides.signalType ?? ("watch" as SignalType);
  const rules = overrides.rules ?? [rule()];
  return {
    symbol: "600001",
    name: "Candidate",
    industry: "industry",
    price: 10,
    signalType,
    score: 80,
    hardRulesPassed: !rules.some((item) => item.severity === "hard" && !item.passed),
    rules,
    ...overrides
  };
}

describe("paper trading attribution", () => {
  it("summarizes why candidates were not bought while keeping strict eligibility separate", () => {
    const report = buildPaperAttribution(
      [
        candidate({
          symbol: "600001",
          rules: [
            rule({ id: "base.range", name: "base width", actual: 32, threshold: "<=25%" }),
            rule({ id: "buy.breakout", name: "breakout", actual: "extension -8%", threshold: "1%-7%" })
          ]
        }),
        candidate({
          symbol: "600002",
          signalType: "breakout",
          rules: [rule({ id: "trend.template", name: "trend", passed: true })]
        })
      ],
      "2026-06-10T09:30:00.000Z"
    );

    expect(report.totalCandidates).toBe(2);
    expect(report.strictEligibleCount).toBe(1);
    expect(report.watchCount).toBe(1);
    expect(report.ruleFailures.map((item) => item.id)).toEqual(["base.range", "buy.breakout"]);
    expect(report.rejections[0]).toMatchObject({
      symbol: "600001",
      failedHardCount: 2,
      relaxedEligible: false
    });
  });

  it("does not treat liquidity or stop-loss failures as relaxed near misses", () => {
    const report = buildPaperAttribution(
      [
        candidate({
          symbol: "600003",
          rules: [rule({ id: "liquidity.prefilter", name: "liquidity", actual: "amount 1y", threshold: ">=2y" })]
        }),
        candidate({
          symbol: "600004",
          rules: [rule({ id: "risk.stop_loss", name: "stop loss", actual: "9%", threshold: "<=7%" })]
        }),
        candidate({
          symbol: "600005",
          rules: [
            rule({ id: "liquidity.prefilter", name: "liquidity", passed: true, severity: "hard" }),
            rule({ id: "trend.template", name: "trend", passed: true, severity: "hard" }),
            rule({ id: "quality.valuation", name: "valuation", passed: true, severity: "hard" }),
            rule({ id: "relative_strength", name: "relative strength", passed: true, severity: "hard" }),
            rule({ id: "base.range", name: "base width", passed: true, severity: "soft" }),
            rule({ id: "base.volume_contraction", name: "volume", passed: true, severity: "soft" }),
            rule({ id: "base.atr_contraction", name: "atr", passed: true, severity: "soft" }),
            rule({ id: "base.volatility_contraction", name: "volatility", passed: true, severity: "soft" }),
            rule({ id: "risk.stop_loss_width", name: "stop width", passed: true, severity: "hard" }),
            rule({ id: "buy.breakout", name: "breakout", actual: "偏离-1% / 量比1.05", threshold: "1%-7%", severity: "info" })
          ]
        })
      ],
      "2026-06-10T09:30:00.000Z"
    );

    expect(report.relaxedEligibleCount).toBe(1);
    expect(report.nearMissCount).toBe(1);
    expect(report.rejections.find((item) => item.symbol === "600005")?.relaxedEligible).toBe(true);
    expect(report.rejections.find((item) => item.symbol === "600003")?.relaxedEligible).toBe(false);
  });

  it("counts an unconfirmed informational breakout as the decision gap for a watch candidate", () => {
    const report = buildPaperAttribution(
      [
        candidate({
          symbol: "600006",
          rules: [
            rule({ id: "trend.template", name: "trend", passed: true }),
            rule({ id: "quality.valuation", name: "valuation", passed: true, severity: "hard" }),
            rule({ id: "relative_strength", name: "relative strength", passed: true, severity: "hard" }),
            rule({ id: "base.range", name: "base width", passed: true, severity: "soft" }),
            rule({ id: "base.volume_contraction", name: "volume", passed: true, severity: "soft" }),
            rule({ id: "base.atr_contraction", name: "atr", passed: true, severity: "soft" }),
            rule({ id: "risk.stop_loss_width", name: "stop width", passed: true, severity: "hard" }),
            rule({ id: "buy.breakout", name: "breakout", severity: "info", passed: false, actual: "偏离-1% / 量比1.0" })
          ]
        })
      ],
      "2026-06-10T09:30:00.000Z"
    );

    expect(report.nearMissCount).toBe(1);
    expect(report.ruleFailures[0]).toMatchObject({ id: "buy.breakout", failedCount: 1 });
    expect(report.rejections[0].failedHardRules).toEqual(["breakout"]);
  });

  it("does not count far below-pivot watch candidates as relaxed near misses", () => {
    const report = buildPaperAttribution(
      [
        candidate({
          symbol: "600007",
          rules: [
            rule({ id: "liquidity.prefilter", name: "liquidity", passed: true, severity: "hard" }),
            rule({ id: "trend.template", name: "trend", passed: true, severity: "hard" }),
            rule({ id: "quality.valuation", name: "valuation", passed: true, severity: "hard" }),
            rule({ id: "relative_strength", name: "relative strength", passed: true, severity: "hard" }),
            rule({ id: "base.range", name: "base width", passed: true, severity: "soft" }),
            rule({ id: "base.volume_contraction", name: "volume", passed: true, severity: "soft" }),
            rule({ id: "base.atr_contraction", name: "atr", passed: true, severity: "soft" }),
            rule({ id: "base.volatility_contraction", name: "volatility", passed: true, severity: "soft" }),
            rule({ id: "risk.stop_loss_width", name: "stop width", passed: true, severity: "hard" }),
            rule({ id: "buy.breakout", name: "breakout", severity: "info", passed: false, actual: "偏离-7.01% / 量比0.99" })
          ]
        })
      ],
      "2026-06-22T15:00:00.000Z"
    );

    expect(report.nearMissCount).toBe(0);
    expect(report.rejections[0].relaxedEligible).toBe(false);
  });
});
