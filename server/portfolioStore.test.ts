import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { readPortfolioDb, writePortfolioDb } from "./portfolioStore";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("portfolio store", () => {
  it("creates a default portfolio database when missing", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mingyuan-portfolio-"));
    const filePath = path.join(tempDir, "portfolio.json");

    const db = await readPortfolioDb(filePath);

    expect(db.accountEquity).toBeGreaterThan(0);
    expect(db.holdings.some((holding) => holding.symbol === "600036")).toBe(true);
  });

  it("persists edited holdings", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mingyuan-portfolio-"));
    const filePath = path.join(tempDir, "portfolio.json");

    await writePortfolioDb(filePath, {
      accountEquity: 100_000,
      cash: 20_000,
      holdings: [
        {
          symbol: "600036",
          name: "招商银行",
          quantity: 100,
          costPrice: 40,
          note: "",
          updatedAt: "2026-06-06T10:00:00.000Z"
        }
      ]
    });

    const db = await readPortfolioDb(filePath);
    expect(db.holdings).toHaveLength(1);
    expect(db.holdings[0].quantity).toBe(100);
  });
});
