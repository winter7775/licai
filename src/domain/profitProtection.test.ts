import { describe, expect, it } from "vitest";
import { calculateAtr, calculateProfitProtectionStop } from "./profitProtection";

describe("profit protection stop", () => {
  it("keeps the initial stop before the position reaches one and a half R", () => {
    const result = calculateProfitProtectionStop({
      entryPrice: 100,
      initialStopPrice: 94,
      currentStopPrice: 94,
      highestPrice: 108
    });

    expect(result.effectiveStopPrice).toBe(94);
    expect(result.profitStopPrice).toBeUndefined();
    expect(result.stage).toBe("initial");
  });

  it("moves to breakeven after one and a half R of profit", () => {
    const result = calculateProfitProtectionStop({
      entryPrice: 100,
      initialStopPrice: 94,
      currentStopPrice: 94,
      highestPrice: 110
    });

    expect(result.effectiveStopPrice).toBe(100);
    expect(result.profitStopPrice).toBe(100);
    expect(result.stage).toBe("breakeven");
  });

  it("protects a share of max profit and never lowers an existing stop", () => {
    const result = calculateProfitProtectionStop({
      entryPrice: 100,
      initialStopPrice: 94,
      currentStopPrice: 116,
      highestPrice: 130,
      atr: 3
    });

    expect(result.profitStopPrice).toBe(113.5);
    expect(result.atrStopPrice).toBe(121);
    expect(result.effectiveStopPrice).toBe(121);
    expect(result.stage).toBe("protect45");
  });

  it("calculates ATR from recent price bars", () => {
    const atr = calculateAtr(
      [
        { high: 12, low: 10, close: 11 },
        { high: 14, low: 11, close: 13 },
        { high: 15, low: 12, close: 14 }
      ],
      3
    );

    expect(atr).toBe(2.67);
  });
});
