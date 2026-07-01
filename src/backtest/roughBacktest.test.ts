import { describe, expect, it } from "vitest";
import {
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
