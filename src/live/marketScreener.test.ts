import { describe, expect, it } from "vitest";
import {
  analyzeHistory,
  evaluatePlatformSetup,
  evaluateTrendTemplate,
  isBreakoutConfirmation,
  parseEastmoneyKline,
  parseEastmoneySpotRow,
  parseSinaSpotRow,
  prefilterSpotStocks,
  selectMarketCapUniverse,
  type DailyBar,
  type SpotStock
} from "./marketScreener";

function makeBars(): DailyBar[] {
  const bars: DailyBar[] = [];

  for (let index = 0; index < 130; index += 1) {
    const close = index < 90 ? 10 + index * 0.025 + (index % 2 === 0 ? -0.14 : 0.14) : 12.2 + ((index % 4) - 2) * 0.004;
    const volume = index >= 120 ? 650_000 : 1_000_000;
    const dailyRange = index < 90 ? 0.25 : 0.04;
    bars.push({
      date: `2026-01-${String(index + 1).padStart(2, "0")}`,
      open: close - 0.04,
      close,
      high: close + dailyRange,
      low: close - dailyRange,
      volume,
      amount: volume * close,
      amplitudePct: 2,
      changePct: 0.2,
      changeAmount: 0.02,
      turnoverRate: 1.5
    });
  }

  const priorPivot = Math.max(...bars.slice(-41, -1).map((bar) => bar.close));
  bars[bars.length - 1] = {
    date: "2026-06-04",
    open: priorPivot * 1.012,
    close: priorPivot * 1.025,
    high: priorPivot * 1.03,
    low: priorPivot * 1.01,
    volume: 2_000_000,
    amount: 2_000_000 * priorPivot,
    amplitudePct: 2,
    changePct: 3,
    changeAmount: 0.3,
    turnoverRate: 3
  };

  return bars;
}

function makeBenchmarkBars(stockBars: DailyBar[], multiplier = 1): DailyBar[] {
  return stockBars.map((bar, index) => ({
    ...bar,
    close: 10 + index * 0.02 * multiplier,
    open: 10 + index * 0.02 * multiplier,
    high: 10 + index * 0.02 * multiplier + 0.1,
    low: 10 + index * 0.02 * multiplier - 0.1
  }));
}

const liquidSpot: SpotStock = {
  symbol: "600879",
  name: "航天电子",
  industry: "军工电子",
  price: 19.73,
  changePct: -1.25,
  changeAmount: -0.25,
  volume: 610_313,
  amount: 1_204_055_318,
  turnoverRate: 1.85,
  peTtm: 42,
  volumeRatio: 1.2,
  high: 20.06,
  low: 19.28,
  open: 19.65,
  previousClose: 19.98,
  totalMarketCap: 50_000_000_000,
  floatMarketCap: 50_000_000_000
};

describe("live market screener", () => {
  it("maps Eastmoney spot fields into stable domain fields", () => {
    const stock = parseEastmoneySpotRow({
      f2: 19.73,
      f3: -1.25,
      f4: -0.25,
      f5: 610313,
      f6: 1204055318,
      f8: 1.85,
      f9: 42.1,
      f10: 1.2,
      f12: "600879",
      f14: "航天电子",
      f15: 20.06,
      f16: 19.28,
      f17: 19.65,
      f18: 19.98,
      f20: 50000000000,
      f21: 50000000000,
      f100: "军工电子"
    });

    expect(stock.symbol).toBe("600879");
    expect(stock.industry).toBe("军工电子");
    expect(stock.amount).toBe(1204055318);
  });

  it("maps Sina market center fields into stable domain fields", () => {
    const stock = parseSinaSpotRow({
      symbol: "sz000725",
      code: "000725",
      name: "京东方Ａ",
      trade: "6.290",
      pricechange: -0.14,
      changepercent: -2.177,
      settlement: "6.430",
      open: "6.480",
      high: "6.740",
      low: "6.220",
      volume: 4599875918,
      amount: 29701641889,
      per: 39.313,
      mktcap: 23300882.352256,
      nmc: 22858906.462268,
      turnoverratio: 12.65731
    });

    expect(stock.symbol).toBe("000725");
    expect(stock.name).toBe("京东方Ａ");
    expect(stock.price).toBe(6.29);
    expect(stock.changePct).toBe(-2.18);
    expect(stock.amount).toBe(29701641889);
    expect(stock.floatMarketCap).toBeCloseTo(228589064622.68, 0);
  });

  it("parses Eastmoney daily kline strings", () => {
    const bar = parseEastmoneyKline("2026-06-04,19.65,19.73,20.06,19.28,610313,1204055318.00,3.90,-1.25,-0.25,1.85");

    expect(bar.date).toBe("2026-06-04");
    expect(bar.close).toBe(19.73);
    expect(bar.turnoverRate).toBe(1.85);
  });

  it("parses Tencent qfq day rows as a history fallback", async () => {
    const { parseTencentQfqRows } = await import("./marketScreener");
    const bars = parseTencentQfqRows([
      ["2026-06-04", "19.65", "19.71", "20.06", "19.28", "986309.00", {}, "2.99", "194398.89", ""],
      ["2026-06-05", "20.04", "21.54", "21.68", "20.00", "2560124.00", {}, "7.76", "536247.50", ""]
    ]);

    expect(bars[1].date).toBe("2026-06-05");
    expect(bars[1].close).toBe(21.54);
    expect(bars[1].amount).toBe(5_362_475_000);
    expect(bars[1].changePct).toBeCloseTo(9.28, 1);
  });

  it("removes ST names and stocks below liquidity thresholds", () => {
    const result = prefilterSpotStocks([
      liquidSpot,
      { ...liquidSpot, symbol: "000001", name: "ST样本" },
      { ...liquidSpot, symbol: "000002", amount: 50_000_000 },
      { ...liquidSpot, symbol: "000003", price: 3.5 }
    ]);

    expect(result.map((stock) => stock.symbol)).toEqual(["600879"]);
  });

  it("builds the screening universe from the top 30 percent by total market cap", () => {
    const stocks = Array.from({ length: 100 }, (_, index) => ({
      ...liquidSpot,
      symbol: String(index).padStart(6, "0"),
      totalMarketCap: (index + 1) * 1_000_000_000,
      floatMarketCap: (index + 1) * 800_000_000
    }));

    const result = selectMarketCapUniverse(stocks, 0.3);

    expect(result).toHaveLength(30);
    expect(result[0].symbol).toBe("000099");
    expect(result[29].symbol).toBe("000070");
  });

  it("keeps the initial prefilter pool bounded to 400 names after the market-cap universe is selected", () => {
    const stocks = Array.from({ length: 500 }, (_, index) => ({
      ...liquidSpot,
      symbol: String(index).padStart(6, "0"),
      amount: 300_000_000 + index,
      totalMarketCap: 1_000_000_000_000 - index * 1_000_000_000,
      floatMarketCap: 800_000_000_000 - index * 800_000_000
    }));

    const result = prefilterSpotStocks(stocks, 400);

    expect(result).toHaveLength(400);
  });

  it("keeps a core 400-name pool and adds rotated supplemental names when the scan target is larger", () => {
    const stocks = Array.from({ length: 900 }, (_, index) => ({
      ...liquidSpot,
      symbol: String(index).padStart(6, "0"),
      amount: 900_000_000 - index * 100_000,
      totalMarketCap: 1_000_000_000_000 - index * 1_000_000_000,
      floatMarketCap: 800_000_000_000 - index * 800_000_000
    }));

    const result = prefilterSpotStocks(stocks, 800, { coreLimit: 400, rotationSeed: "2026-06-23" });

    expect(result).toHaveLength(800);
    expect(result.slice(0, 400).map((stock) => stock.symbol)).toEqual(stocks.slice(0, 400).map((stock) => stock.symbol));
    expect(result.some((stock) => Number(stock.symbol) >= 800)).toBe(true);
  });

  it("keeps large liquid stocks in the 400-name pool even when PE or daily change is not textbook-perfect", () => {
    const stocks = [
      { ...liquidSpot, symbol: "000001", peTtm: -8, changePct: -5, amount: 500_000_000 },
      { ...liquidSpot, symbol: "000002", peTtm: 120, changePct: 9, amount: 450_000_000 }
    ];

    expect(prefilterSpotStocks(stocks, 400).map((stock) => stock.symbol)).toEqual(["000001", "000002"]);
  });

  it("accepts a moderately compressed platform when at least two quality dimensions pass", () => {
    const result = evaluatePlatformSetup({
      baseRangePct: 32,
      volumeRatio: 0.98,
      atrRatio: 1.05,
      volatilityRatio: 1.08
    });

    expect(result.rangePassed).toBe(true);
    expect(result.qualityPassCount).toBe(2);
    expect(result.passed).toBe(true);
  });

  it("accepts an early confirmed breakout near the pivot without requiring a 50 percent volume surge", () => {
    expect(
      isBreakoutConfirmation({
        extensionPct: -0.4,
        volume20Ratio: 1.2,
        volume60Ratio: 1.05,
        closeLocation: 0.58,
        changePct: 3
      })
    ).toBe(true);
  });

  it("accepts a developing medium-term uptrend with small moving-average deviations", () => {
    expect(
      evaluateTrendTemplate({
        close: 100,
        ma20: 99,
        ma60: 100,
        ma60TwentyDaysAgo: 101,
        ma120: 99,
        longLow: 75,
        longHigh: 135
      })
    ).toBe(true);
  });

  it("detects a qualified platform breakout from daily history", () => {
    const analysis = analyzeHistory(liquidSpot, makeBars());

    expect(
      analysis.signalType,
      JSON.stringify(analysis.rules.map((rule) => ({ id: rule.id, actual: rule.actual, passed: rule.passed })))
    ).toBe("breakout");
    expect(analysis.rules.find((rule) => rule.id === "trend.template")?.passed).toBe(true);
    expect(analysis.rules.find((rule) => rule.id === "buy.breakout")?.passed).toBe(true);
    expect(analysis.rules.find((rule) => rule.id === "base.volume_contraction")?.severity).toBe("soft");
    expect(analysis.stopLossWidthPct).toBeLessThanOrEqual(7);
    expect(analysis.pivotPrice).toBeGreaterThan(0);
  });

  it("requires a buy candidate to hold positive relative strength versus the benchmark", () => {
    const bars = makeBars();
    const benchmarkBars = makeBenchmarkBars(bars, 8);
    const analysis = analyzeHistory(liquidSpot, bars, { benchmarkBars });

    expect(analysis.rules.find((rule) => rule.id === "relative_strength")?.passed).toBe(false);
    expect(analysis.signalType).toBe("watch");
  });

  it("treats invalid valuation quality as a hard blocker", () => {
    const analysis = analyzeHistory({ ...liquidSpot, peTtm: -8 }, makeBars());

    expect(analysis.rules.find((rule) => rule.id === "quality.valuation")?.passed).toBe(false);
    expect(analysis.signalType).toBe("watch");
  });

  it("does not count an unconfirmed breakout as a failed hard rule for a watch candidate", () => {
    const bars = makeBars();
    const priorPivot = Math.max(...bars.slice(-41, -1).map((bar) => bar.close));
    bars[bars.length - 1] = {
      ...bars[bars.length - 1],
      open: priorPivot * 0.97,
      close: priorPivot * 0.98,
      high: priorPivot * 0.99,
      low: priorPivot * 0.96,
      volume: 700_000
    };

    const analysis = analyzeHistory(liquidSpot, bars);

    expect(analysis.signalType).toBe("watch");
    expect(analysis.rules.find((rule) => rule.id === "buy.breakout")?.severity).toBe("info");
  });

  it("does not call a pullback when the earlier breakout lacked a qualified platform", () => {
    const bars = makeBars();
    bars[100] = { ...bars[100], open: 9, close: 9, high: 9.2, low: 8.8 };
    bars[125] = {
      ...bars[125],
      open: 12.35,
      close: 12.5,
      high: 12.55,
      low: 12.3,
      volume: 2_000_000,
      changePct: 3
    };
    for (let index = 126; index < 129; index += 1) {
      bars[index] = { ...bars[index], open: 12.4, close: 12.42, high: 12.48, low: 12.36, volume: 500_000 };
    }
    bars[129] = {
      ...bars[129],
      open: 12.2,
      close: 12.25,
      high: 12.28,
      low: 12.18,
      volume: 500_000,
      changePct: -1
    };

    const analysis = analyzeHistory(liquidSpot, bars);
    expect(analysis.signalType).not.toBe("pullback");
    expect(analysis.stopPrice).toBeLessThan(bars[bars.length - 1].close);
    expect(analysis.stopLossWidthPct).toBeGreaterThan(0);
  });
});
