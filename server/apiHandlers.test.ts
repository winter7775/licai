import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PaperAccount } from "../src/domain/paperTrading";
import {
  buildPaperTradingResponse,
  fetchPaperHoldingBars,
  fillMissingPaperQuotePrices,
  handleApiRequest,
  hasPaperReviewForDate,
  paperQuotesFromSummary,
  shouldSkipPaperTradingReview,
  withTimeout
} from "./apiHandlers";
import { writePaperQuoteSnapshot } from "./paperQuoteStore";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    end(value: string) {
      this.body = value;
    }
  };
}

describe("shared api handlers", () => {
  it("returns false for non-api routes", async () => {
    const response = createMockResponse();

    const handled = await handleApiRequest({ method: "GET", url: "/" }, response, new URL("http://127.0.0.1/"));

    expect(handled).toBe(false);
    expect(response.body).toBe("");
  });

  it("serves live health with json headers", async () => {
    const response = createMockResponse();

    const handled = await handleApiRequest(
      { method: "GET", url: "/api/live/health" },
      response,
      new URL("http://127.0.0.1/api/live/health")
    );

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(response.body)).toMatchObject({
      provider: "eastmoney-public",
      ready: true,
      deployment: null
    });
  });

  it("detects whether the paper account has already been reviewed for a trading date", () => {
    expect(
      hasPaperReviewForDate(
        {
          initialCapital: 200000,
          cash: 200000,
          holdings: [],
          trades: [],
          updatedAt: "2026-06-18T07:00:00.000Z",
          reviews: [
            {
              id: "review-2026-06-18",
              date: "2026-06-18",
              actionSummary: "无新增交易",
              marketGate: "防守观察",
              targetExposurePct: 35,
              decisions: [],
              createdAt: "2026-06-18T07:00:00.000Z"
            }
          ]
        },
        "2026-06-18"
      )
    ).toBe(true);
  });

  it("fills missing paper holding quotes from latest daily history close", async () => {
    const result = await fillMissingPaperQuotePrices(["002179", "600961"], { "600961": 29 }, async (symbol) => {
      if (symbol === "002179") {
        return [
          { date: "2026-06-19", close: 42.73 },
          { date: "2026-06-22", close: 44.12 }
        ] as any;
      }
      return [];
    });

    expect(result.quotes).toEqual({ "002179": 44.12, "600961": 29 });
    expect(result.previousCloses).toEqual({ "002179": 42.73 });
    expect(result.filledSymbols).toEqual(["002179"]);
    expect(result.missingSymbols).toEqual([]);
  });

  it("does not block paper quotes when a holding history request hangs", async () => {
    const result = await fillMissingPaperQuotePrices(
      ["002179"],
      {},
      {},
      () => new Promise(() => {}),
      { perSymbolTimeoutMs: 5 }
    );

    expect(result.quotes).toEqual({});
    expect(result.missingSymbols).toEqual(["002179"]);
  });

  it("starts missing paper holding history requests in parallel", async () => {
    const calls: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const resultPromise = fillMissingPaperQuotePrices(["002179", "600961"], {}, async (symbol) => {
      calls.push(symbol);
      if (symbol === "002179") {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return [
        { date: "2026-07-02", close: symbol === "002179" ? 42 : 28 },
        { date: "2026-07-03", close: symbol === "002179" ? 43 : 29 }
      ] as any;
    });

    await Promise.resolve();

    expect(calls).toEqual(["002179", "600961"]);
    releaseFirst?.();
    await expect(resultPromise).resolves.toMatchObject({
      quotes: { "002179": 43, "600961": 29 },
      previousCloses: { "002179": 42, "600961": 28 },
      missingSymbols: []
    });
  });

  it("uses the last paper quote snapshot when live holding quotes time out", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "paper-api-quotes-"));
    const snapshotPath = path.join(tempDir, "paper-quote-snapshot.json");
    await writePaperQuoteSnapshot(snapshotPath, {
      updatedAt: "2026-07-03T07:00:00.000Z",
      quotes: { "002422": 44.72 },
      previousCloses: { "002422": 43.95 }
    });
    const account: PaperAccount = {
      initialCapital: 200000,
      cash: 195000,
      holdings: [
        {
          symbol: "002422",
          name: "科伦药业",
          industry: "医药",
          quantity: 100,
          avgCost: 37.31,
          initialStopPrice: 36.94,
          stopPrice: 36.94,
          highestPriceSinceEntry: 44.72,
          takeProfitPrice: 52.23,
          openedAt: "2026-07-01T07:00:00.000Z",
          updatedAt: "2026-07-01T07:00:00.000Z",
          reason: "test"
        }
      ],
      trades: [],
      reviews: [],
      updatedAt: "2026-07-01T07:00:00.000Z"
    };

    const response = await buildPaperTradingResponse(account, {
      quoteSnapshotPath: snapshotPath,
      spotProvider: () => new Promise(() => {}),
      quoteTimeoutMs: 5,
      useHistoryFallback: false
    });

    expect(response.summary.holdings[0]).toMatchObject({
      currentPrice: 44.72,
      previousClose: 43.95,
      todayPnl: 77,
      unrealizedPnl: 741
    });
    expect(response.summary.totalReturn).toBe(-528);
    expect(response.quoteStatus.mode).toBe("fallback");
    expect(response.quoteStatus.warnings.some((warning) => warning.includes("行情快照"))).toBe(true);
  });

  it("rejects long-running optional work with a timeout", async () => {
    await expect(withTimeout(new Promise(() => {}), 5, "too slow")).rejects.toThrow("too slow");
  });

  it("builds paper holding quote and risk inputs for auto trading", async () => {
    expect(
      paperQuotesFromSummary({
        holdings: [
          { symbol: "600001", currentPrice: 11 },
          { symbol: "600002", currentPrice: 20 }
        ]
      } as any)
    ).toEqual({ "600001": 11, "600002": 20 });

    const bars = await fetchPaperHoldingBars(["600001", "600002"], async (symbol) => {
      if (symbol === "600001") {
        return [
          { date: "2026-06-23", high: 11.2, low: 10.2, close: 11 },
          { date: "2026-06-24", high: 11.8, low: 10.9, close: 11.6 }
        ] as any;
      }
      throw new Error("network");
    });

    expect(bars["600001"]).toHaveLength(2);
    expect(bars["600002"]).toBeUndefined();
  });

  it("allows a same-day paper review to run again when the completed scan was refreshed later", () => {
    const account = {
      initialCapital: 200000,
      cash: 200000,
      holdings: [],
      trades: [],
      updatedAt: "2026-06-23T07:00:00.000Z",
      reviews: [
        {
          id: "review-2026-06-23",
          date: "2026-06-23",
          actionSummary: "reviewed",
          marketGate: "defensive",
          targetExposurePct: 35,
          decisions: [],
          createdAt: "2026-06-23T06:30:00.000Z"
        }
      ]
    };

    expect(shouldSkipPaperTradingReview(account, "2026-06-23", "2026-06-23T07:05:00.000Z", true)).toBe(false);
    expect(shouldSkipPaperTradingReview(account, "2026-06-23", "2026-06-23T06:00:00.000Z", true)).toBe(true);
  });
});
