import { describe, expect, it } from "vitest";
import { buildStrictMonthlyBacktestMarkdown } from "./strictMonthlyBacktestJob";
import type { StrictBacktestResult, StrictMonteCarloResult } from "../src/backtest/strictMonthlyBacktest";

describe("strict monthly backtest job report", () => {
  it("renders strict replay outputs and audit file location", () => {
    const backtest = {
      startedAt: "2016-07-01",
      endedAt: "2026-06-30",
      initialCapital: 200_000,
      finalAssets: 280_000,
      totalReturnPct: 40,
      cagrPct: 3.4,
      maxDrawdownPct: 12,
      tradeCount: 80,
      winRatePct: 42,
      profitFactor: 1.8,
      averageWinPct: 18,
      averageLossPct: -5,
      expectancyPct: 2.4,
      auditSummary: {
        records: 1_600_000,
        buySignals: 100,
        trialSignals: 80,
        watch: 1_000_000,
        rejected: 599_800,
        errors: 20
      },
      monthlySnapshots: [{ activeMonth: "2020-02", asOfDate: "2020-01-23", symbols: ["000001"], rankMetric: "trailing_amount" }],
      warnings: ["strict warning"]
    } as StrictBacktestResult;
    const monteCarlo = {
      iterations: 5000,
      tradeSamplesPerRun: 80,
      finalAssets: { p5: 180_000, p25: 230_000, p50: 280_000, p75: 350_000, p95: 480_000 },
      maxDrawdownPct: { p5: 8, p25: 12, p50: 16, p75: 24, p95: 32 },
      lossProbabilityPct: 12,
      severeDrawdownProbabilityPct: 4
    } as StrictMonteCarloResult;

    const markdown = buildStrictMonthlyBacktestMarkdown({
      generatedAt: "2026-07-01T10:00:00.000Z",
      sourceUniverseCount: 1600,
      usableUniverseCount: 800,
      historyYears: 10,
      auditPath: "/tmp/audit.jsonl",
      backtest,
      monteCarlo
    });

    expect(markdown).toContain("Strict monthly top-pool backtest");
    expect(markdown).toContain("Final assets: 280,000");
    expect(markdown).toContain("Audit records: 1,600,000");
    expect(markdown).toContain("/tmp/audit.jsonl");
    expect(markdown).toContain("strict warning");
  });
});
