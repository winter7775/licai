import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { applyPaperTrade, createInitialPaperAccount } from "../src/domain/paperTrading";
import { readPaperTradingDb, writePaperTradingDb } from "./paperTradingStore";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("paper trading store", () => {
  it("creates a default 200000 CNY paper account when missing", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mingyuan-paper-"));
    const filePath = path.join(tempDir, "paper-trading.json");

    const db = await readPaperTradingDb(filePath);

    expect(db.initialCapital).toBe(200000);
    expect(db.cash).toBe(200000);
    expect(db.holdings).toEqual([]);
  });

  it("persists paper trades and holdings", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mingyuan-paper-"));
    const filePath = path.join(tempDir, "paper-trading.json");
    const account = applyPaperTrade(createInitialPaperAccount("2026-06-09T09:30:00.000Z"), {
      side: "buy",
      symbol: "600879",
      name: "航天电子",
      industry: "军工电子",
      quantity: 1000,
      price: 20,
      stopPrice: 18.8,
      takeProfitPrice: 28,
      reason: "测试买入",
      tradedAt: "2026-06-09T10:00:00.000Z"
    });

    await writePaperTradingDb(filePath, account);

    const db = await readPaperTradingDb(filePath);
    expect(db.holdings).toHaveLength(1);
    expect(db.holdings[0]).toMatchObject({
      initialStopPrice: 18.8,
      highestPriceSinceEntry: 20,
      profitProtectionStage: "initial",
      protectedProfitPct: 0
    });
    expect(db.trades).toHaveLength(1);
    expect(db.cash).toBe(180000);
  });
});
