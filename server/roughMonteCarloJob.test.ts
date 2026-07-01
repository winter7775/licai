import { describe, expect, it } from "vitest";
import { buildRoughBacktestMarkdown } from "./roughMonteCarloJob";
import type { RoughBacktestResult, RoughMonteCarloResult } from "../src/backtest/roughBacktest";

describe("rough monte carlo job report", () => {
  it("renders the key backtest and monte carlo metrics", () => {
    const backtest = {
      startedAt: "2016-07-01",
      endedAt: "2026-06-30",
      initialCapital: 200000,
      finalAssets: 260000,
      totalReturnPct: 30,
      cagrPct: 2.66,
      maxDrawdownPct: 12.5,
      tradeCount: 42,
      winRatePct: 45.2,
      profitFactor: 1.4,
      averageWinPct: 18,
      averageLossPct: -6,
      expectancyPct: 2.1,
      warnings: ["rough warning"]
    } as RoughBacktestResult;
    const monteCarlo = {
      iterations: 1000,
      tradeSamplesPerRun: 42,
      finalAssets: { p5: 150000, p25: 210000, p50: 260000, p75: 330000, p95: 450000 },
      maxDrawdownPct: { p5: 8, p25: 12, p50: 18, p75: 25, p95: 35 },
      lossProbabilityPct: 18.2,
      severeDrawdownProbabilityPct: 6.4
    } as RoughMonteCarloResult;

    const markdown = buildRoughBacktestMarkdown({
      generatedAt: "2026-07-01T10:00:00.000Z",
      universeCount: 120,
      historyYears: 10,
      backtest,
      monteCarlo
    });

    expect(markdown).toContain("粗测版十年回测 + 蒙特卡洛");
    expect(markdown).toContain("初始本金：200,000");
    expect(markdown).toContain("最终资产：260,000");
    expect(markdown).toContain("P50：260,000");
    expect(markdown).toContain("rough warning");
  });
});
