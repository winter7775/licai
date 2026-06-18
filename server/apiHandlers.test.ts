import { describe, expect, it } from "vitest";
import { handleApiRequest, hasPaperReviewForDate } from "./apiHandlers";

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
});
