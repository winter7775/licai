import { describe, expect, it } from "vitest";
import { buildRetailSentimentFromCycle } from "./sentimentScoring";

describe("sentiment scoring", () => {
  it("builds a current RHI snapshot from market-cycle metrics", () => {
    const snapshot = buildRetailSentimentFromCycle({
      targetDate: "2026-06-05",
      turnoverVs20d: 1.2,
      turnoverPercentile: 60,
      advancersRatio: 0.58,
      limitUpCount: 72,
      limitDownCount: 8,
      highestConsecutiveLimit: 5,
      limitUpOpenFailureRate: 0.22,
      marginBalanceChangePct: 0.1,
      topIndustries: [
        ["半导体", 9],
        ["电力", 6]
      ],
      grossExposure: 0.32,
      hotTopicExposure: 0.1,
      singleNameMax: 0.12
    });

    expect(snapshot.asOf).toBe("2026-06-05 收盘");
    expect(snapshot.market).toBe("A股");
    expect(snapshot.retailHeat).toBeGreaterThan(50);
    expect(snapshot.categoryScores.find((item) => item.name === "价格成交")?.score).toBeGreaterThan(50);
    expect(snapshot.sources.some((source) => source.name.includes("市场周期"))).toBe(true);
    expect(snapshot.missingData).toContain("舆情新闻：社交讨论热度和新闻热度缺失");
  });
});
