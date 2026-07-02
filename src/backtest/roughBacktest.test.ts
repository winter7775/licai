import { describe, expect, it } from "vitest";
import {
  calculateBenchmarkExposureLimit,
  calculateRoughPositionSize,
  runMonteCarloFromClosedTrades,
  type RoughBacktestConfig,
  type RoughClosedTrade
} from "./roughBacktest";

const config: RoughBacktestConfig = {
  initialCapital: 200_000,
  warmupDays: 260,
  maxExposurePct: 35,
  maxSinglePositionPct: 10,
  maxTrialSinglePositionPct: 3,
  maxTrialTotalPositionPct: 10,
  maxHoldings: 8,
  minBuyAmount: 5_000,
  lotSize: 100
};

describe("rough backtest position sizing", () => {
  it("caps strict A-grade entries at the configured single-position percentage", () => {
    const sizing = calculateRoughPositionSize({
      grade: "A",
      price: 20,
      totalAssets: 200_000,
      cash: 200_000,
      currentMarketValue: 0,
      currentTrialMarketValue: 0,
      config
    });

    expect(sizing.quantity).toBe(1000);
    expect(sizing.amount).toBe(20_000);
    expect(sizing.positionPct).toBe(10);
  });

  it("caps B-grade trial entries at three percent and respects the total B-grade budget", () => {
    const sizing = calculateRoughPositionSize({
      grade: "B",
      price: 20,
      totalAssets: 200_000,
      cash: 200_000,
      currentMarketValue: 0,
      currentTrialMarketValue: 16_000,
      config
    });

    expect(sizing.quantity).toBe(200);
    expect(sizing.amount).toBe(4_000);
    expect(sizing.canBuy).toBe(false);
    expect(sizing.reason).toBe("below_min_buy_amount");
  });

  it("sizes A-grade entries from the stop distance before applying the single-position cap", () => {
    const sizing = calculateRoughPositionSize({
      grade: "A",
      price: 20,
      stopPrice: 18,
      totalAssets: 200_000,
      cash: 200_000,
      currentMarketValue: 0,
      currentTrialMarketValue: 0,
      currentPortfolioRiskAmount: 0,
      config: {
        ...config,
        maxSinglePositionPct: 12,
        riskPerTradePct: 1,
        maxPortfolioRiskPct: 6,
        minBuyAmount: 1_000
      }
    });

    expect(sizing.quantity).toBe(1000);
    expect(sizing.amount).toBe(20_000);
    expect(sizing.positionPct).toBe(10);
    expect(sizing.riskAmount).toBe(2_000);
  });

  it("keeps B-grade trial entries smaller by using the trial risk budget", () => {
    const sizing = calculateRoughPositionSize({
      grade: "B",
      price: 20,
      stopPrice: 18,
      totalAssets: 200_000,
      cash: 200_000,
      currentMarketValue: 0,
      currentTrialMarketValue: 0,
      currentPortfolioRiskAmount: 0,
      config: {
        ...config,
        trialRiskPerTradePct: 0.3,
        maxTrialSinglePositionPct: 3,
        minBuyAmount: 1_000
      }
    });

    expect(sizing.quantity).toBe(300);
    expect(sizing.amount).toBe(6_000);
    expect(sizing.positionPct).toBe(3);
    expect(sizing.riskAmount).toBe(600);
  });

  it("blocks new entries when the portfolio risk budget is already full", () => {
    const sizing = calculateRoughPositionSize({
      grade: "A",
      price: 20,
      stopPrice: 18,
      totalAssets: 200_000,
      cash: 200_000,
      currentMarketValue: 0,
      currentTrialMarketValue: 0,
      currentPortfolioRiskAmount: 12_000,
      config: {
        ...config,
        riskPerTradePct: 1,
        maxPortfolioRiskPct: 6,
        minBuyAmount: 1_000
      }
    });

    expect(sizing.canBuy).toBe(false);
    expect(sizing.reason).toBe("portfolio_risk_full");
  });

  it("raises the total exposure limit to ninety percent only in a strong benchmark trend", () => {
    const weakBars = Array.from({ length: 130 }, (_, index) => ({
      date: `2020-01-${String(index + 1).padStart(2, "0")}`,
      open: 100 - index * 0.1,
      close: 100 - index * 0.1,
      high: 101 - index * 0.1,
      low: 99 - index * 0.1,
      volume: 1_000_000,
      amount: 100_000_000,
      amplitudePct: 2,
      changePct: 0,
      changeAmount: 0,
      turnoverRate: 1
    }));
    const strongBars = Array.from({ length: 130 }, (_, index) => ({
      ...weakBars[index],
      open: 100 + index * 0.4,
      close: 100 + index * 0.4,
      high: 101 + index * 0.4,
      low: 99 + index * 0.4
    }));

    expect(calculateBenchmarkExposureLimit(weakBars, config)).toBe(0);
    expect(calculateBenchmarkExposureLimit(strongBars, { ...config, strongTrendExposurePct: 90 })).toBe(90);
  });
});

describe("rough monte carlo", () => {
  it("returns stable percentile metrics from closed trade samples", () => {
    const trades: RoughClosedTrade[] = [
      { symbol: "000001", entryDate: "2020-01-01", exitDate: "2020-02-01", returnPct: 10, positionPct: 10, pnl: 2_000 },
      { symbol: "000002", entryDate: "2020-03-01", exitDate: "2020-04-01", returnPct: -5, positionPct: 10, pnl: -1_000 },
      { symbol: "000003", entryDate: "2020-05-01", exitDate: "2020-06-01", returnPct: 20, positionPct: 3, pnl: 1_200 }
    ];

    const result = runMonteCarloFromClosedTrades(trades, {
      initialCapital: 200_000,
      iterations: 200,
      seed: 7
    });

    expect(result.iterations).toBe(200);
    expect(result.finalAssets.p50).toBeGreaterThan(200_000);
    expect(result.lossProbabilityPct).toBeGreaterThanOrEqual(0);
    expect(result.lossProbabilityPct).toBeLessThanOrEqual(100);
  });
});
