import type { StrategyParams } from "./types";

export const defaultStrategyParams: StrategyParams = {
  version: "right-side-midterm-v0.2",
  market: {
    minIndexScore: 70,
    redLightBlocksNewEntries: true
  },
  stock: {
    maxStopLossPct: 7,
    mainTakeProfitPct: 40,
    maxSinglePositionPct: 12,
    maxIndustryPositionPct: 25,
    maxHoldings: 6,
    accountRiskPct: 1
  },
  pattern: {
    minPlatformDays: 15,
    maxPlatformWidthPct: 12,
    minBreakoutVolumeRatio: 1.5,
    maxBuyExtensionPct: 3
  }
};
