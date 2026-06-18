import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiveScan, fetchPaperTrading, mapLiveCandidate, runPaperTrading, runPaperTradingScanBatch } from "./liveAdapter";
import type { LiveScanResponseDto, LiveScreenedStockDto, PaperTradingResponseDto } from "./liveTypes";

const liveCandidate: LiveScreenedStockDto = {
  spot: {
    symbol: "600879",
    name: "航天电子",
    industry: "军工电子",
    price: 19.73,
    changePct: -1.25,
    changeAmount: -0.25,
    volume: 610313,
    amount: 1204055318,
    turnoverRate: 1.85,
    peTtm: 42,
    volumeRatio: 1.2,
    high: 20.06,
    low: 19.28,
    open: 19.65,
    previousClose: 19.98,
    totalMarketCap: 50000000000,
    floatMarketCap: 50000000000
  },
  history: [
    {
      date: "2026-06-03",
      open: 19.23,
      close: 19.98,
      high: 20.68,
      low: 19.23,
      volume: 1502630,
      amount: 2989416616,
      amplitudePct: 7.48,
      changePct: 3.04,
      changeAmount: 0.59,
      turnoverRate: 4.55
    },
    {
      date: "2026-06-04",
      open: 19.65,
      close: 19.73,
      high: 20.06,
      low: 19.28,
      volume: 610313,
      amount: 1204055318,
      amplitudePct: 3.9,
      changePct: -1.25,
      changeAmount: -0.25,
      turnoverRate: 1.85
    }
  ],
  analysis: {
    signalType: "breakout",
    pivotPrice: 19.2,
    baseLow: 17.9,
    baseRangePct: 7.26,
    stopPrice: 18.62,
    stopLossWidthPct: 5.63,
    buyExtensionPct: 2.76,
    ma20: 18.8,
    ma60: 17.9,
    ma120: 16.7,
    rules: [
      {
        id: "trend.template",
        name: "趋势模板",
        actual: "通过",
        threshold: "通过",
        passed: true,
        severity: "hard"
      }
    ]
  },
  score: 88
};

describe("live adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps live screening data into page signals while retaining the position gate", () => {
    const signal = mapLiveCandidate(liveCandidate);

    expect(signal.symbol).toBe("600879");
    expect(signal.entryPrice).toBe(19.73);
    expect(signal.signalLabel).toBe("平台突破");
    expect(signal.tradability).toBe("观察");
    expect(signal.gate).toBe("blocked");
    expect(signal.tags).toContain("真实行情");
  });

  it("requests a full-market scan while only displaying the top 10 recommendations", async () => {
    const scan: LiveScanResponseDto = {
      provider: "eastmoney-public",
      sourceLabel: "东方财富公开行情接口",
      asOf: "2026-06-08T09:30:00.000Z",
      tradeDate: "2026-06-05",
      universeCount: 5532,
      prefilteredCount: 10,
      analyzedCount: 10,
      candidateCount: 0,
      signalCount: 0,
      watchCount: 0,
      durationMs: 100,
      candidates: [],
      warnings: []
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => scan
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveScan();

    expect(fetchMock).toHaveBeenCalledWith("/api/live/screen?scan=full&display=10");
  });

  it("requests a bounded daily-history depth when scan depth is provided", async () => {
    const scan: LiveScanResponseDto = {
      provider: "eastmoney-public",
      sourceLabel: "东方财富公开行情接口",
      asOf: "2026-06-09T09:30:00.000Z",
      tradeDate: "2026-06-09",
      universeCount: 5532,
      prefilteredCount: 80,
      analyzedCount: 80,
      candidateCount: 10,
      signalCount: 0,
      watchCount: 80,
      durationMs: 100,
      candidates: [],
      warnings: []
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => scan
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchLiveScan({ force: true, historyLimit: 80 });

    expect(fetchMock).toHaveBeenCalledWith("/api/live/screen?scan=full&display=10&history=80&refresh=1");
  });

  it("loads the paper trading account", async () => {
    const payload: PaperTradingResponseDto = {
      account: {
        initialCapital: 200000,
        cash: 200000,
        holdings: [],
        trades: [],
        reviews: [],
        updatedAt: "2026-06-09T09:30:00.000Z"
      },
      summary: {
        initialCapital: 200000,
        cash: 200000,
        marketValue: 0,
        totalAssets: 200000,
        totalReturn: 0,
        totalReturnPct: 0,
        exposurePct: 0,
        holdings: []
      },
      quoteStatus: {
        mode: "live",
        warnings: [],
        updatedAt: "2026-06-09T09:30:00.000Z"
      }
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetchMock);

    await fetchPaperTrading();

    expect(fetchMock).toHaveBeenCalledWith("/api/paper-trading");
  });

  it("runs one automatic paper trading cycle", async () => {
    const payload: PaperTradingResponseDto = {
      account: {
        initialCapital: 200000,
        cash: 200000,
        holdings: [],
        trades: [],
        reviews: [],
        updatedAt: "2026-06-09T09:30:00.000Z"
      },
      summary: {
        initialCapital: 200000,
        cash: 200000,
        marketValue: 0,
        totalAssets: 200000,
        totalReturn: 0,
        totalReturnPct: 0,
        exposurePct: 0,
        holdings: []
      },
      quoteStatus: {
        mode: "live",
        warnings: [],
        updatedAt: "2026-06-09T09:30:00.000Z"
      }
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetchMock);

    await runPaperTrading(true);

    expect(fetchMock).toHaveBeenCalledWith("/api/paper-trading/run?refresh=1", { method: "POST" });
  });

  it("runs one background paper scan batch", async () => {
    const payload: PaperTradingResponseDto = {
      account: {
        initialCapital: 200000,
        cash: 200000,
        holdings: [],
        trades: [],
        reviews: [],
        updatedAt: "2026-06-09T09:30:00.000Z"
      },
      summary: {
        initialCapital: 200000,
        cash: 200000,
        marketValue: 0,
        totalAssets: 200000,
        totalReturn: 0,
        totalReturnPct: 0,
        exposurePct: 0,
        holdings: []
      },
      quoteStatus: {
        mode: "live",
        warnings: [],
        updatedAt: "2026-06-09T09:30:00.000Z"
      }
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetchMock);

    await runPaperTradingScanBatch({ batchSize: 5 });

    expect(fetchMock).toHaveBeenCalledWith("/api/paper-trading/background-scan/step?batch=5", { method: "POST" });
  });
});
