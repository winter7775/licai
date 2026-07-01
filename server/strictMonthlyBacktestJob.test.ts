import { describe, expect, it } from "vitest";
import {
  buildHistoryMonthlyIndex,
  buildMonthlySnapshotsFromHistoryIndexes,
  buildStrictMonthlyBacktestMarkdown,
  selectStrictSourceUniverse
} from "./strictMonthlyBacktestJob";
import type { StrictBacktestResult, StrictMonteCarloResult } from "../src/backtest/strictMonthlyBacktest";
import type { DailyBar, SpotStock } from "../src/live/marketScreener";

function stock(symbol: string, totalMarketCap: number): SpotStock {
  return {
    symbol,
    name: symbol,
    industry: "test",
    price: 10,
    changePct: 0,
    changeAmount: 0,
    volume: 1_000_000,
    amount: 100_000_000,
    turnoverRate: 1,
    peTtm: 20,
    volumeRatio: 1,
    high: 10,
    low: 10,
    open: 10,
    previousClose: 10,
    totalMarketCap,
    floatMarketCap: totalMarketCap
  };
}

function bar(date: string, amount: number): DailyBar {
  return {
    date,
    open: 10,
    close: 10,
    high: 10,
    low: 10,
    volume: 1000,
    amount,
    amplitudePct: 0,
    changePct: 0,
    changeAmount: 0,
    turnoverRate: 1
  };
}

describe("strict monthly backtest job report", () => {
  it("builds monthly snapshots from lightweight history indexes", () => {
    const highInJanuary = buildHistoryMonthlyIndex(stock("000001", 1), [bar("2020-01-30", 900), bar("2020-02-03", 10)], 1);
    const highInFebruaryOnly = buildHistoryMonthlyIndex(stock("000002", 1), [bar("2020-01-30", 20), bar("2020-02-03", 1000)], 1);

    const snapshots = buildMonthlySnapshotsFromHistoryIndexes([highInJanuary, highInFebruaryOnly], 1);

    expect(snapshots).toEqual([
      {
        activeMonth: "2020-02",
        asOfDate: "2020-01-30",
        symbols: ["000001"],
        rankMetric: "trailing_amount"
      }
    ]);
  });

  it("keeps the full ranked source universe when the source limit is zero", () => {
    const result = selectStrictSourceUniverse([stock("000001", 3), stock("000002", 2), stock("000003", 1)], {
      marketCapTopPct: 1,
      sourceLimit: 0
    });

    expect(result.map((item) => item.symbol)).toEqual(["000001", "000002", "000003"]);
  });

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
      historyFailedCount: 40,
      historyYears: 10,
      auditPath: "/tmp/audit.jsonl",
      backtest,
      monteCarlo
    });

    expect(markdown).toContain("Strict monthly top-pool backtest");
    expect(markdown).toContain("Final assets: 280,000");
    expect(markdown).toContain("History failures/skips: 40");
    expect(markdown).toContain("Audit records: 1,600,000");
    expect(markdown).toContain("/tmp/audit.jsonl");
    expect(markdown).toContain("strict warning");
  });
});
