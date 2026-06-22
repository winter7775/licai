import { describe, expect, it } from "vitest";
import { createPaperScanState, markPaperScanError, mergePaperScanBatch } from "./paperScanState";
import type { LiveScanResponse } from "./eastmoneyProvider";

function batch(overrides: Partial<LiveScanResponse> = {}): LiveScanResponse {
  return {
    provider: "eastmoney-public",
    sourceLabel: "source",
    asOf: "2026-06-10T09:40:00.000Z",
    tradeDate: "2026-06-10",
    universeCount: 5532,
    marketCapUniverseCount: 1600,
    marketCapTopPct: 30,
    initialPoolTarget: 400,
    prefilteredCount: 120,
    analyzedCount: 2,
    candidateCount: 2,
    signalCount: 0,
    watchCount: 2,
    durationMs: 100,
    warnings: ["warning"],
    candidates: [
      {
        spot: {
          symbol: "600001",
          name: "A",
          industry: "tech",
          price: 10,
          changePct: 0,
          changeAmount: 0,
          volume: 1,
          amount: 300_000_000,
          turnoverRate: 1,
          peTtm: 20,
          volumeRatio: 1,
          high: 10,
          low: 9.8,
          open: 9.9,
          previousClose: 9.9,
          totalMarketCap: 10_000_000_000,
          floatMarketCap: 8_000_000_000
        },
        history: [],
        score: 80,
        analysis: {
          signalType: "watch",
          pivotPrice: 10.2,
          baseLow: 9,
          baseRangePct: 13,
          stopPrice: 9.3,
          stopLossWidthPct: 7,
          buyExtensionPct: -2,
          ma20: 9.7,
          ma60: 9.1,
          ma120: 8.8,
          rules: [
            {
              id: "liquidity.prefilter",
              name: "liquidity",
              actual: "pass",
              threshold: "pass",
              passed: true,
              severity: "hard"
            },
            {
              id: "trend.template",
              name: "trend",
              actual: "pass",
              threshold: "pass",
              passed: true,
              severity: "hard"
            },
            {
              id: "base.range",
              name: "base width",
              actual: "13%",
              threshold: "ok",
              passed: true,
              severity: "soft"
            },
            {
              id: "base.volume_contraction",
              name: "volume",
              actual: "pass",
              threshold: "ok",
              passed: true,
              severity: "soft"
            },
            {
              id: "base.atr_contraction",
              name: "atr",
              actual: "pass",
              threshold: "ok",
              passed: true,
              severity: "soft"
            },
            {
              id: "risk.stop_loss_width",
              name: "stop width",
              actual: "7%",
              threshold: "ok",
              passed: true,
              severity: "hard"
            },
            {
              id: "buy.breakout",
              name: "breakout",
              actual: "偏离-2% / 量比1.0",
              threshold: "1%-7%",
              passed: false,
              severity: "info"
            }
          ]
        }
      }
    ],
    ...overrides
  };
}

describe("paper background scan state", () => {
  it("merges scan batches and advances the cursor without losing rejection attribution", () => {
    const initial = createPaperScanState({
      date: "2026-06-10",
      batchSize: 40,
      dailyLimit: 300
    });

    const next = mergePaperScanBatch(initial, batch(), 40);

    expect(next.status).toBe("running");
    expect(next.cursor).toBe(40);
    expect(next.analyzedCount).toBe(2);
    expect(next.marketCapUniverseCount).toBe(1600);
    expect(next.scanPolicy.marketCapTopPct).toBe(30);
    expect(next.scanPolicy.initialPoolTarget).toBe(400);
    expect(next.scanPolicy.strategyVersion).toBe("v2");
    expect(next.candidates).toHaveLength(1);
    expect(next.attribution.ruleFailures[0]).toMatchObject({ id: "buy.breakout", failedCount: 1 });
    expect(next.attribution.relaxedEligibleCount).toBe(1);
  });

  it("marks the scan complete when the next cursor reaches the daily limit or prefiltered universe", () => {
    const initial = createPaperScanState({
      date: "2026-06-10",
      batchSize: 40,
      dailyLimit: 80
    });

    const next = mergePaperScanBatch({ ...initial, cursor: 40 }, batch({ prefilteredCount: 120 }), 40);

    expect(next.status).toBe("complete");
    expect(next.cursor).toBe(80);
  });

  it("keeps the cursor unchanged when a provider fallback makes the scan invalid", () => {
    const initial = createPaperScanState({
      date: "2026-06-10",
      batchSize: 40,
      dailyLimit: 400
    });

    const next = markPaperScanError(initial, "full-market provider degraded to seed data");

    expect(next.status).toBe("error");
    expect(next.cursor).toBe(0);
    expect(next.warnings[0]).toContain("seed data");
  });
});
