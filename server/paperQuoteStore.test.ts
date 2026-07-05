import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPaperQuoteSnapshot,
  fillQuotesFromSnapshot,
  readPaperQuoteSnapshot,
  writePaperQuoteSnapshot
} from "./paperQuoteStore";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

describe("paper quote store", () => {
  it("fills missing holding quotes from the last successful trading-day snapshot", () => {
    const filled = fillQuotesFromSnapshot(
      ["002422", "600030"],
      { "600030": 28.73 },
      {},
      {
        updatedAt: "2026-07-03T07:00:00.000Z",
        quotes: { "002422": 44.72 },
        previousCloses: { "002422": 43.95 }
      }
    );

    expect(filled.quotes).toEqual({ "002422": 44.72, "600030": 28.73 });
    expect(filled.previousCloses).toEqual({ "002422": 43.95 });
    expect(filled.filledSymbols).toEqual(["002422"]);
  });

  it("persists only valid quote values and preserves previous snapshot values for missing symbols", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "paper-quotes-"));
    const filePath = path.join(tempDir, "paper-quotes.json");
    const snapshot = buildPaperQuoteSnapshot(
      ["002422", "600030"],
      { "600030": 28.73 },
      { "600030": 28.49 },
      "2026-07-05T03:30:00.000Z",
      {
        updatedAt: "2026-07-03T07:00:00.000Z",
        quotes: { "002422": 44.72 },
        previousCloses: { "002422": 43.95 }
      }
    );

    await writePaperQuoteSnapshot(filePath, snapshot);

    await expect(readPaperQuoteSnapshot(filePath)).resolves.toEqual({
      updatedAt: "2026-07-05T03:30:00.000Z",
      quotes: { "002422": 44.72, "600030": 28.73 },
      previousCloses: { "002422": 43.95, "600030": 28.49 }
    });
  });
});
