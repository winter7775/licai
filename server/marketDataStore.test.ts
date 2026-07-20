import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readHistorySnapshot, readSpotSnapshot, writeHistorySnapshot, writeSpotSnapshot } from "./marketDataStore";

let tempDir = "";

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = "";
});

describe("market data snapshots", () => {
  it("persists and restores a complete full-market spot snapshot", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mingyuan-spot-"));
    const filePath = path.join(tempDir, "spot.json");
    const snapshot = {
      updatedAt: "2026-07-20T07:00:00.000Z",
      total: 1,
      stocks: [{ symbol: "600519", name: "Kweichow Moutai", price: 1327.5 } as any]
    };

    await writeSpotSnapshot(filePath, snapshot);

    await expect(readSpotSnapshot(filePath)).resolves.toEqual(snapshot);
  });

  it("keeps the newest requested daily bars for provider fallback", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mingyuan-history-"));
    const bars = [
      { date: "2026-07-16", close: 10 },
      { date: "2026-07-17", close: 11 },
      { date: "2026-07-20", close: 12 }
    ] as any;

    await writeHistorySnapshot(tempDir, "000001", bars, "tencent");

    await expect(readHistorySnapshot(tempDir, "000001", 2)).resolves.toMatchObject({
      symbol: "000001",
      provider: "tencent",
      bars: [
        { date: "2026-07-17", close: 11 },
        { date: "2026-07-20", close: 12 }
      ]
    });
  });
});
