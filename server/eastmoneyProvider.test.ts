import { describe, expect, it } from "vitest";
import {
  alignSpotWithLatestHistory,
  clearSpotUniverseCache,
  collectBatchPayloads,
  collectEastmoneySpotPayloads,
  collectSinaSpotPayloads,
  eastmoneySpotPageNumbers,
  fetchSpotForScreen,
  getSpotUniverseForScreen,
  historyProviderForSpotMode,
  latestHistoryTradeDate,
  marketDataKey,
  fetchTencentHoldingQuotes,
  parseTencentQuotePayload,
  TENCENT_HOLDING_QUOTE_RETRY_BUDGET_MS,
  pickTopRecommendations,
  retryFailedBatchResults,
  selectHistoryCandidates,
  sinaSpotPageWorkers
} from "./eastmoneyProvider";
import type { LiveScreenedStock } from "./eastmoneyProvider";

describe("eastmoney provider helpers", () => {
  it("reuses one full-market snapshot across scan batches until the cache expires", async () => {
    clearSpotUniverseCache();
    let calls = 0;
    const result = {
      spot: { total: 5_527, stocks: [] },
      warnings: [],
      mode: "sina" as const
    };
    const loader = async () => {
      calls += 1;
      return result;
    };

    await getSpotUniverseForScreen(loader, () => 1_000);
    await getSpotUniverseForScreen(loader, () => 1_001);

    expect(calls).toBe(1);
    expect(await getSpotUniverseForScreen(loader, () => 1_000 + 10 * 60 * 1_000)).toBe(result);
    expect(calls).toBe(2);
    clearSpotUniverseCache();
  });

  it("keeps successful batch payloads and reports failed requests", () => {
    const result = collectBatchPayloads([
      { ok: true, data: { value: 1 } },
      { ok: false, error: "socket reset" },
      { ok: true, data: { value: 2 } }
    ]);

    expect(result.payloads).toEqual([{ value: 1 }, { value: 2 }]);
    expect(result.failedCount).toBe(1);
    expect(result.errors[0]).toContain("socket reset");
  });

  it("uses the newest history bar as the scan trade date", () => {
    const analyzed = [
      { history: [{ date: "2026-06-04" }, { date: "2026-06-05" }] },
      { history: [{ date: "2026-06-03" }] }
    ] as LiveScreenedStock[];

    expect(latestHistoryTradeDate(analyzed)).toBe("2026-06-05");
  });

  it("falls back to the last successful spot snapshot when both live spot APIs are unavailable", async () => {
    const cachedStocks = Array.from({ length: 5_000 }, (_, index) => ({
      symbol: String(index).padStart(6, "0")
    })) as any[];
    const result = await fetchSpotForScreen(
      async () => {
        throw new Error("Sina unavailable");
      },
      async () => {
        throw new Error("Eastmoney unavailable");
      },
      async () => ({
        updatedAt: "2026-07-17T07:00:00.000Z",
        total: 5_000,
        stocks: cachedStocks
      })
    );

    expect(result.mode).toBe("cache");
    expect(result.spot.stocks).toHaveLength(5_000);
    expect(result.warnings.join(" ")).toContain("2026-07-17T07:00:00.000Z");
  });

  it("uses Sina as the primary full-market spot source", async () => {
    const result = await fetchSpotForScreen(
      async () => ({
        total: 1,
        stocks: [
          {
            symbol: "000725",
            name: "京东方Ａ",
            industry: "未分类",
            price: 6.29,
            changePct: -2.18,
            changeAmount: -0.14,
            volume: 4599875918,
            amount: 29701641889,
            turnoverRate: 12.6573,
            peTtm: 39.31,
            volumeRatio: 1,
            high: 6.74,
            low: 6.22,
            open: 6.48,
            previousClose: 6.43,
            totalMarketCap: 233008823522.56,
            floatMarketCap: 228589064622.68
          }
        ]
      }),
      async () => {
        throw new Error("Eastmoney should not be called");
      },
      async () => null,
      async () => {}
    );

    expect(result.mode).toBe("sina");
    expect(result.spot.total).toBe(1);
    expect(result.spot.stocks[0].symbol).toBe("000725");
    expect(result.warnings).toEqual([]);
  });

  it("rejects a misleading partial Eastmoney snapshot before ranking the top 30 percent", async () => {
    const partialStocks = Array.from({ length: 100 }, (_, index) => ({
      symbol: String(index).padStart(6, "0")
    })) as any[];
    const fallbackStocks = Array.from({ length: 5_000 }, (_, index) => ({
      symbol: String(index).padStart(6, "0")
    })) as any[];

    const result = await fetchSpotForScreen(
      async () => ({ total: 5_533, stocks: partialStocks }),
      async () => ({ total: 5_000, stocks: fallbackStocks }),
      async () => null,
      async () => {}
    );

    expect(result.mode).toBe("eastmoney");
    expect(result.spot.stocks).toHaveLength(5_000);
  });

  it("builds all Eastmoney page numbers needed for a capped 100-row endpoint", () => {
    const pages = eastmoneySpotPageNumbers(5_533, 100);

    expect(pages).toHaveLength(56);
    expect(pages[0]).toBe(1);
    expect(pages[55]).toBe(56);
  });

  it("collects Eastmoney spot pages and removes duplicate symbols", () => {
    const row = (symbol: string) => ({ f12: symbol, f14: symbol, f2: 10, f6: 300_000_000, f20: 10_000_000_000, f21: 8_000_000_000 });
    const result = collectEastmoneySpotPayloads([
      { ok: true, data: { data: { diff: [row("000001"), row("000002")] } } },
      { ok: true, data: { data: { diff: [row("000002"), row("000003")] } } },
      { ok: false, error: "timeout" }
    ]);

    expect(result.stocks.map((stock) => stock.symbol)).toEqual(["000001", "000002", "000003"]);
    expect(result.failedCount).toBe(1);
  });

  it("collects successful Sina pages and reports failed pages", () => {
    const result = collectSinaSpotPayloads([
      {
        ok: true,
        data: [
          {
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
          }
        ]
      },
      { ok: false, error: "timeout" }
    ]);

    expect(result.stocks).toHaveLength(1);
    expect(result.stocks[0].symbol).toBe("000725");
    expect(result.errors[0]).toContain("timeout");
  });

  it("keeps Sina market center page requests on low concurrency because the endpoint rejects larger bursts", () => {
    expect(sinaSpotPageWorkers()).toBe(3);
  });

  it("uses Tencent as the primary daily-history source for every spot mode", () => {
    expect(historyProviderForSpotMode("eastmoney")).toBe("tencent");
    expect(historyProviderForSpotMode("sina")).toBe("tencent");
    expect(historyProviderForSpotMode("cache")).toBe("tencent");
  });

  it("routes Beijing Stock Exchange symbols to the bj market instead of Shanghai", () => {
    expect(marketDataKey("920045")).toEqual({ tencent: "bj920045", eastmoney: "0.920045" });
    expect(marketDataKey("600030")).toEqual({ tencent: "sh600030", eastmoney: "1.600030" });
    expect(marketDataKey("000001")).toEqual({ tencent: "sz000001", eastmoney: "0.000001" });
  });

  it("parses targeted Tencent holding quotes for Shanghai and Beijing symbols", () => {
    const quotes = parseTencentQuotePayload(
      'v_sh600030="1~CITIC~600030~28.28~27.60~27.76";\n' +
        'v_bj920045="1~BSE~920045~288.93~305.80~303.00";'
    );

    expect(quotes).toEqual([
      { symbol: "600030", name: "CITIC", price: 28.28, previousClose: 27.6 },
      { symbol: "920045", name: "BSE", price: 288.93, previousClose: 305.8 }
    ]);
  });

  it("retries a transient targeted Tencent quote failure", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const result = await fetchTencentHoldingQuotes(
      ["600030"],
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("socket reset");
        return new Response('v_sh600030="1~CITIC~600030~28.28~27.60~27.76";');
      },
      {
        attempts: 2,
        timeoutMs: 100,
        sleep: async (delayMs) => {
          sleeps.push(delayMs);
        }
      }
    );

    expect(attempts).toBe(2);
    expect(sleeps).toEqual([150]);
    expect(result).toEqual({ quotes: { "600030": 28.28 }, previousCloses: { "600030": 27.6 } });
  });

  it("keeps the complete targeted quote retry budget below the paper API timeout", () => {
    expect(TENCENT_HOLDING_QUOTE_RETRY_BUDGET_MS).toBe(3_450);
    expect(TENCENT_HOLDING_QUOTE_RETRY_BUDGET_MS).toBeLessThan(5_000);
  });

  it("retries only unusable history results at lower concurrency and preserves item order", async () => {
    const calls: Array<{ items: string[]; workers: number }> = [];
    const sleeps: number[] = [];
    const results = await retryFailedBatchResults(
      ["000001", "000002", "000003"],
      async (items, workers) => {
        calls.push({ items, workers });
        if (calls.length === 1) {
          return [
            { ok: true, data: { bars: [1] } },
            { ok: false, error: "connection reset" },
            { ok: true, data: { bars: [] } }
          ];
        }
        return items.map((item) => ({ ok: true, data: { bars: [item] } }));
      },
      {
        workers: 3,
        retryWorkers: 1,
        retryDelayMs: 1_200,
        isUsable: (result) => result.ok && Array.isArray(result.data?.bars) && result.data.bars.length > 0,
        sleep: async (delayMs) => {
          sleeps.push(delayMs);
        }
      }
    );

    expect(calls).toEqual([
      { items: ["000001", "000002", "000003"], workers: 3 },
      { items: ["000002", "000003"], workers: 1 }
    ]);
    expect(sleeps).toEqual([1_200]);
    expect(results.map((result) => result.data?.bars?.[0])).toEqual([1, "000002", "000003"]);
  });

  it("uses the latest history bar as the live price when screening from a fallback seed", () => {
    const spot = {
      symbol: "600879",
      name: "航天电子",
      industry: "军工电子",
      price: 10,
      changePct: 0,
      changeAmount: 0,
      volume: 1,
      amount: 300_000_000,
      turnoverRate: 1,
      peTtm: 42,
      volumeRatio: 1,
      high: 10,
      low: 10,
      open: 10,
      previousClose: 10,
      totalMarketCap: 50_000_000_000,
      floatMarketCap: 50_000_000_000
    };

    const aligned = alignSpotWithLatestHistory(spot, [
      {
        date: "2026-06-08",
        open: 21.5,
        close: 21.97,
        high: 22.1,
        low: 21.2,
        volume: 123456,
        amount: 270_000_000,
        amplitudePct: 3,
        changePct: 2.1,
        changeAmount: 0.45,
        turnoverRate: 1.4
      }
    ]);

    expect(aligned.price).toBe(21.97);
    expect(aligned.amount).toBe(270_000_000);
    expect(aligned.changePct).toBe(2.1);
  });

  it("returns only the requested number of top recommendations after ranking the analyzed pool", () => {
    const analyzed = Array.from({ length: 15 }, (_, index) => ({
      spot: { symbol: String(index).padStart(6, "0") },
      history: [],
      analysis: { signalType: index % 2 === 0 ? "breakout" : "watch" },
      score: index
    })) as LiveScreenedStock[];

    const result = pickTopRecommendations(analyzed, 10);

    expect(result).toHaveLength(10);
    expect(result[0].analysis.signalType).toBe("breakout");
    expect(result[0].score).toBe(14);
  });

  it("limits the daily-history pass after full-market spot prefiltering", () => {
    const stocks = Array.from({ length: 100 }, (_, index) => ({
      symbol: String(index).padStart(6, "0")
    }));

    const result = selectHistoryCandidates(stocks, 80);

    expect(result).toHaveLength(80);
    expect(result[0].symbol).toBe("000000");
    expect(result[79].symbol).toBe("000079");
  });

  it("can page through full-market prefiltered stocks for background paper scans", () => {
    const stocks = Array.from({ length: 100 }, (_, index) => ({
      symbol: String(index).padStart(6, "0")
    }));

    const result = selectHistoryCandidates(stocks, 40, 40);

    expect(result).toHaveLength(40);
    expect(result[0].symbol).toBe("000040");
    expect(result[39].symbol).toBe("000079");
  });
});
