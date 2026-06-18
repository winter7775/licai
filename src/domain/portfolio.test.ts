import { describe, expect, it } from "vitest";
import { calculatePortfolioSummary, upsertHolding } from "./portfolio";

describe("portfolio domain", () => {
  it("updates an existing holding and recalculates exposure from latest prices", () => {
    const portfolio = {
      accountEquity: 100_000,
      cash: 40_000,
      holdings: [
        {
          symbol: "600036",
          name: "招商银行",
          quantity: 400,
          costPrice: 38.8,
          note: "试仓",
          updatedAt: "2026-06-01T00:00:00.000Z"
        }
      ]
    };

    const updated = upsertHolding(portfolio, {
      symbol: "600036",
      name: "招商银行",
      quantity: 500,
      costPrice: 39.2,
      note: "加仓后成本",
      updatedAt: "2026-06-06T10:00:00.000Z"
    });
    const summary = calculatePortfolioSummary(updated, {
      "600036": { price: 42, name: "招商银行", industry: "银行" }
    });

    expect(updated.holdings).toHaveLength(1);
    expect(updated.holdings[0].quantity).toBe(500);
    expect(summary.marketValue).toBe(21_000);
    expect(summary.exposurePct).toBe(21);
    expect(summary.totalCost).toBe(19_600);
    expect(summary.unrealizedPnl).toBe(1_400);
  });

  it("removes a holding when quantity is set to zero", () => {
    const portfolio = {
      accountEquity: 100_000,
      cash: 40_000,
      holdings: [
        {
          symbol: "600036",
          name: "招商银行",
          quantity: 400,
          costPrice: 38.8,
          note: "",
          updatedAt: "2026-06-01T00:00:00.000Z"
        }
      ]
    };

    const updated = upsertHolding(portfolio, {
      symbol: "600036",
      name: "招商银行",
      quantity: 0,
      costPrice: 0,
      note: "清仓",
      updatedAt: "2026-06-06T10:00:00.000Z"
    });

    expect(updated.holdings).toEqual([]);
  });
});
