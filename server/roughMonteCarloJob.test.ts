import { describe, expect, it } from "vitest";
import { buildRoughBacktestMarkdown, loadRoughBacktestBenchmark, loadRoughBacktestSpot } from "./roughMonteCarloJob";
import type { RoughBacktestResult, RoughMonteCarloResult } from "../src/backtest/roughBacktest";

describe("rough monte carlo job report", () => {
  it("falls back to a proxy benchmark when the benchmark provider fails", async () => {
    const fallbackBars = Array.from({ length: 260 }, (_, index) => ({
      date: `2020-01-${String((index % 28) + 1).padStart(2, "0")}`,
      open: 10,
      close: 10 + index / 100,
      high: 11,
      low: 9,
      volume: 1000,
      amount: 1000000,
      amplitudePct: 1,
      changePct: 0,
      changeAmount: 0,
      turnoverRate: 1
    }));

    const result = await loadRoughBacktestBenchmark({
      limit: 260,
      provider: async () => {
        throw new Error("benchmark api failed");
      },
      readCache: async () => null,
      writeCache: async () => undefined,
      fallbackBars
    });

    expect(result.bars).toHaveLength(260);
    expect(result.warnings[0]).toContain("benchmark api failed");
    expect(result.warnings[1]).toContain("proxy benchmark");
  });

  it("loads the stock universe through a fallback-capable provider", async () => {
    const result = await loadRoughBacktestSpot(async () => ({
      mode: "sina",
      warnings: ["fallback used"],
      spot: {
        total: 1,
        stocks: [
          {
            symbol: "600000",
            name: "浦发银行",
            industry: "银行",
            price: 10,
            changePct: 0,
            changeAmount: 0,
            volume: 1000000,
            amount: 100000000,
            turnoverRate: 1,
            peTtm: 10,
            volumeRatio: 1,
            high: 10,
            low: 10,
            open: 10,
            previousClose: 10,
            totalMarketCap: 100000000000,
            floatMarketCap: 90000000000
          }
        ]
      }
    }));

    expect(result.stocks).toHaveLength(1);
    expect(result.warnings).toContain("fallback used");
    expect(result.mode).toBe("sina");
  });

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
