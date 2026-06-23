import { describe, expect, it } from "vitest";
import { fillMissingPaperQuotePrices, handleApiRequest, hasPaperReviewForDate, shouldSkipPaperTradingReview } from "./apiHandlers";

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
      ready: true
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
    expect(result.filledSymbols).toEqual(["002179"]);
    expect(result.missingSymbols).toEqual([]);
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
