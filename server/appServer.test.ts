import { describe, expect, it } from "vitest";
import { contentTypeForPath, shouldServeIndexHtml } from "./appServer";

describe("production app server helpers", () => {
  it("uses index fallback for non-api extensionless routes", () => {
    expect(shouldServeIndexHtml("/")).toBe(true);
    expect(shouldServeIndexHtml("/paper")).toBe(true);
    expect(shouldServeIndexHtml("/api/live/health")).toBe(false);
    expect(shouldServeIndexHtml("/assets/index.js")).toBe(false);
  });

  it("returns stable content types for built assets", () => {
    expect(contentTypeForPath("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeForPath("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeForPath("style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeForPath("data.json")).toBe("application/json; charset=utf-8");
  });
});
