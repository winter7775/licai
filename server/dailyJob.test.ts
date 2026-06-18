import { describe, expect, it } from "vitest";
import { runDailyJob } from "./dailyJob";

describe("daily cloud job", () => {
  it("runs scan batches until complete then runs paper trading", async () => {
    const calls: string[] = [];
    let step = 0;

    const result = await runDailyJob({
      now: new Date("2026-06-18T17:10:00+08:00"),
      maxBatches: 3,
      resetScan: async () => {
        calls.push("reset");
        return { scanState: { status: "running", analyzedCount: 0, cursor: 0 } };
      },
      scanStep: async () => {
        calls.push("scan");
        step += 1;
        return { scanState: { status: step >= 2 ? "complete" : "running", analyzedCount: step * 40, cursor: step * 40 } };
      },
      runPaper: async () => {
        calls.push("paper");
        return { run: { trades: [{ symbol: "600000" }] }, summary: { exposurePct: 3 } };
      },
      writeLog: async () => {
        calls.push("log");
      }
    });

    expect(calls).toEqual(["reset", "scan", "scan", "paper", "log"]);
    expect(result.scanCompleted).toBe(true);
    expect(result.paperRan).toBe(true);
    expect(result.tradeCount).toBe(1);
  });

  it("writes compact log details instead of full scan candidate payloads", async () => {
    let capturedDetail: unknown = null;

    await runDailyJob({
      now: new Date("2026-06-18T17:10:00+08:00"),
      maxBatches: 1,
      resetScan: async () => ({ scanState: { status: "running", analyzedCount: 0 }, candidates: [{ symbol: "600000" }] }),
      scanStep: async () => ({ scanState: { status: "complete", analyzedCount: 40 }, candidates: [{ symbol: "600001" }] }),
      runPaper: async () => ({ run: { trades: [] }, summary: { exposurePct: 0 }, account: { holdings: [] } }),
      writeLog: async (_summary, detail) => {
        capturedDetail = detail;
      }
    });

    const text = JSON.stringify(capturedDetail);
    expect(text).toContain("analyzedCount");
    expect(text).not.toContain("candidates");
    expect(text.length).toBeLessThan(1500);
  });
});
