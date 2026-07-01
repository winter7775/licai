import { describe, expect, it } from "vitest";
import type { DailyBar, HistoryAnalysis, SpotStock } from "../live/marketScreener";
import { buildMonthlyUniverseSnapshots, runStrictMonthlyBacktest } from "./strictMonthlyBacktest";

function stock(symbol: string, name = symbol): SpotStock {
  return {
    symbol,
    name,
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
    totalMarketCap: 0,
    floatMarketCap: 0
  };
}

function bar(date: string, close: number, amount: number): DailyBar {
  return {
    date,
    open: close,
    close,
    high: close * 1.01,
    low: close * 0.99,
    volume: amount / close,
    amount,
    amplitudePct: 2,
    changePct: 0,
    changeAmount: 0,
    turnoverRate: 1
  };
}

function risingBars(symbol: string, start = 10): { stock: SpotStock; history: DailyBar[] } {
  const first = Date.UTC(2020, 0, 1);
  const history = Array.from({ length: 150 }, (_, index) => {
    const currentDate = new Date(first + index * 86_400_000);
    const date = currentDate.toISOString().slice(0, 10);
    const close = start + index * 0.08;
    return {
      date,
      open: close * 0.99,
      close,
      high: close * 1.02,
      low: close * 0.98,
      volume: 1_000_000 + index * 1000,
      amount: 200_000_000 + index * 1_000_000,
      amplitudePct: 4,
      changePct: 0.5,
      changeAmount: 0.05,
      turnoverRate: 1
    };
  });
  return { stock: stock(symbol), history };
}

describe("strict monthly universe snapshots", () => {
  it("uses the prior month-end data to select the next month's pool", () => {
    const highInJanuary = {
      stock: stock("000001", "January leader"),
      history: [bar("2020-01-30", 10, 900_000_000), bar("2020-02-03", 10, 10_000_000)]
    };
    const highInFebruaryOnly = {
      stock: stock("000002", "February leader"),
      history: [bar("2020-01-30", 10, 20_000_000), bar("2020-02-03", 10, 1_000_000_000)]
    };

    const snapshots = buildMonthlyUniverseSnapshots({
      universe: [highInJanuary, highInFebruaryOnly],
      tradeDates: ["2020-01-30", "2020-02-03"],
      poolSize: 1,
      lookbackDays: 1
    });

    expect(snapshots).toEqual([
      {
        activeMonth: "2020-02",
        asOfDate: "2020-01-30",
        symbols: ["000001"],
        rankMetric: "trailing_amount"
      }
    ]);
  });
});

describe("strict monthly backtest replay", () => {
  it("executes a signal on the next trading day's open and records auditable evidence", () => {
    const item = risingBars("000001");
    const benchmarkBars = item.history.map((daily) => ({ ...daily, close: daily.close * 0.98 }));
    const auditRecords: unknown[] = [];
    const analyze = (currentStock: SpotStock, bars: DailyBar[]): HistoryAnalysis => {
      const current = bars[bars.length - 1];
      return {
        signalType: bars.length === 130 ? "breakout" : "watch",
        pivotPrice: current.close * 0.98,
        baseLow: current.close * 0.9,
        baseRangePct: 8,
        stopPrice: current.close * 0.94,
        stopLossWidthPct: 6,
        buyExtensionPct: 1,
        ma20: current.close,
        ma60: current.close,
        ma120: current.close,
        rules: [
          { id: "liquidity.prefilter", name: "liquidity", actual: currentStock.amount, threshold: "ok", passed: true, severity: "hard", explanation: "" },
          { id: "trend.template", name: "trend", actual: "ok", threshold: "ok", passed: true, severity: "hard", explanation: "" },
          { id: "quality.valuation", name: "valuation", actual: 20, threshold: "ok", passed: true, severity: "hard", explanation: "" },
          { id: "relative_strength", name: "rs", actual: "ok", threshold: "ok", passed: true, severity: "hard", explanation: "" },
          { id: "risk.stop_loss_width", name: "risk", actual: 6, threshold: "<=7", passed: true, severity: "hard", explanation: "" },
          { id: "base.range", name: "range", actual: 8, threshold: "<=35", passed: true, severity: "hard", explanation: "" },
          { id: "base.volume_contraction", name: "volume", actual: 1, threshold: "<=1.05", passed: true, severity: "soft", explanation: "" },
          { id: "base.atr_contraction", name: "atr", actual: 1, threshold: "<=1.1", passed: true, severity: "soft", explanation: "" },
          { id: "base.volatility_contraction", name: "vol", actual: 1, threshold: "<=1.05", passed: true, severity: "soft", explanation: "" },
          { id: "buy.breakout", name: "breakout", actual: "ok", threshold: "ok", passed: true, severity: "hard", explanation: "" }
        ]
      };
    };

    const result = runStrictMonthlyBacktest({
      universe: [item],
      benchmarkBars,
      config: {
        initialCapital: 200_000,
        warmupDays: 120,
        monthlyPoolSize: 1,
        monthlyPoolLookbackDays: 20,
        maxExposurePct: 35,
        maxSinglePositionPct: 10,
        maxTrialSinglePositionPct: 3,
        maxTrialTotalPositionPct: 10,
        maxHoldings: 8,
        minBuyAmount: 1_000,
        lotSize: 100
      },
      analyze,
      onAuditRecord: (record) => auditRecords.push(record)
    });

    const firstBuy = result.trades.find((trade) => trade.side === "buy");
    expect(firstBuy).toBeDefined();
    expect(firstBuy?.reason).toContain("signalDate=");
    expect(firstBuy?.date).not.toBe(firstBuy?.reason.match(/signalDate=([^;]+)/)?.[1]);
    expect(auditRecords.length).toBeGreaterThan(0);
    expect(auditRecords[0]).toMatchObject({
      date: expect.any(String),
      symbol: "000001",
      poolAsOfDate: expect.any(String),
      historyEndDate: expect.any(String),
      decision: expect.any(String)
    });
  });
});
