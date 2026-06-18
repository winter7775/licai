import { describe, expect, it } from "vitest";
import {
  buildLocalPortfolioSearchResults,
  buildPaperTradingScreenOptions,
  markPaperTradingCachedScan,
  paperCandidateFromLiveStock,
  parseLiveScreenRequestOptions,
  shouldFetchPaperQuotes,
  shouldQueryLiveForPortfolioSearch
} from "./liveApiPlugin";

describe("live API portfolio search helpers", () => {
  it("builds local search results from the portfolio database without requiring live quotes", () => {
    const results = buildLocalPortfolioSearchResults(
      {
        accountEquity: 357000,
        cash: 145000,
        holdings: [
          {
            symbol: "600036",
            name: "招商银行",
            quantity: 400,
            costPrice: 38.8,
            note: "",
            updatedAt: "2026-06-08T00:00:00.000Z"
          }
        ]
      },
      "600036"
    );

    expect(results).toEqual([
      {
        symbol: "600036",
        name: "招商银行",
        industry: "本地持仓",
        price: 38.8,
        changePct: 0,
        source: "portfolio"
      }
    ]);
  });

  it("does not query live search when the local portfolio already has a match", () => {
    expect(
      shouldQueryLiveForPortfolioSearch([
        {
          symbol: "600036",
          name: "招商银行",
          industry: "未分类",
          price: 38.8,
          changePct: 0,
          source: "portfolio"
        }
      ])
    ).toBe(false);
  });

  it("queries live search when no local portfolio match exists", () => {
    expect(shouldQueryLiveForPortfolioSearch([])).toBe(true);
  });

  it("labels cached scans when paper trading reuses the latest successful full-market result", () => {
    const scan = markPaperTradingCachedScan({
      asOf: "2026-06-09T10:00:00.000Z",
      warnings: ["old warning"]
    } as any);

    expect(scan.asOf).not.toBe("2026-06-09T10:00:00.000Z");
    expect(scan.warnings[0]).toContain("模拟盘使用最近一次成功扫描缓存");
    expect(scan.warnings).toContain("old warning");
  });
});

describe("paper trading live candidate mapping", () => {
  it("marks candidates with failed hard rules as not tradable for paper auto-buy", () => {
    const candidate = paperCandidateFromLiveStock({
      spot: {
        symbol: "600879",
        name: "航天电子",
        industry: "军工电子",
        price: 20,
        changePct: 1,
        changeAmount: 0.2,
        volume: 1,
        amount: 300_000_000,
        turnoverRate: 1,
        peTtm: 40,
        volumeRatio: 1,
        high: 20.5,
        low: 19.5,
        open: 19.8,
        previousClose: 19.8,
        totalMarketCap: 50_000_000_000,
        floatMarketCap: 50_000_000_000
      },
      history: [],
      score: 80,
      analysis: {
        signalType: "breakout",
        pivotPrice: 19.5,
        baseLow: 18,
        baseRangePct: 8,
        stopPrice: 18.8,
        stopLossWidthPct: 6,
        buyExtensionPct: 2,
        ma20: 19,
        ma60: 18,
        ma120: 17,
        rules: [
          {
            id: "base.range",
            name: "平台宽度",
            actual: 30,
            threshold: "<=25%",
            passed: false,
            severity: "hard"
          }
        ]
      }
    });

    expect(candidate.symbol).toBe("600879");
    expect(candidate.hardRulesPassed).toBe(false);
    expect(candidate.takeProfitPrice).toBe(28);
  });
});

describe("paper trading screen options", () => {
  it("skips live paper quote refresh when the paper account has no holdings", () => {
    expect(shouldFetchPaperQuotes([])).toBe(false);
    expect(shouldFetchPaperQuotes(["600879"])).toBe(true);
  });

  it("uses a bounded daily-history pass for foreground auto-runs while keeping the full spot universe", () => {
    expect(buildPaperTradingScreenOptions(true)).toEqual({
      force: true,
      prefilterLimit: undefined,
      historyLimit: 20,
      displayLimit: 20
    });
  });
});

describe("live screen request options", () => {
  it("treats scan=full as an uncapped spot scan with a bounded daily-history pass", () => {
    const options = parseLiveScreenRequestOptions(new URL("http://127.0.0.1/api/live/screen?scan=full&display=10"));

    expect(options).toEqual({
      force: false,
      prefilterLimit: undefined,
      historyLimit: 20,
      displayLimit: 10
    });
  });

  it("keeps the legacy limit parameter as a capped scan for compatibility", () => {
    const options = parseLiveScreenRequestOptions(new URL("http://127.0.0.1/api/live/screen?limit=25&refresh=1"));

    expect(options).toEqual({
      force: true,
      prefilterLimit: 25,
      historyLimit: 25,
      displayLimit: 10
    });
  });

  it("allows full scans to request a larger bounded daily-history pass", () => {
    const options = parseLiveScreenRequestOptions(new URL("http://127.0.0.1/api/live/screen?scan=full&history=160"));

    expect(options.historyLimit).toBe(160);
  });
});
