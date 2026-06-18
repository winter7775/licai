import { describe, expect, it } from "vitest";
import { buildDailyJobMarkdown, runDailyJob, sendWeComMarkdown } from "./dailyJob";

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
      notify: async () => {
        calls.push("notify");
        return true;
      },
      writeLog: async () => {
        calls.push("log");
      }
    });

    expect(calls).toEqual(["reset", "scan", "scan", "paper", "notify", "log"]);
    expect(result.scanCompleted).toBe(true);
    expect(result.paperRan).toBe(true);
    expect(result.tradeCount).toBe(1);
    expect(result.notificationSent).toBe(true);
  });

  it("writes compact log details instead of full scan candidate payloads", async () => {
    let capturedDetail: unknown = null;

    await runDailyJob({
      now: new Date("2026-06-18T17:10:00+08:00"),
      maxBatches: 1,
      resetScan: async () => ({ scanState: { status: "running", analyzedCount: 0 }, candidates: [{ symbol: "600000" }] }),
      scanStep: async () => ({ scanState: { status: "complete", analyzedCount: 40 }, candidates: [{ symbol: "600001" }] }),
      runPaper: async () => ({ run: { trades: [] }, summary: { exposurePct: 0 }, account: { holdings: [] } }),
      notify: async () => false,
      writeLog: async (_summary, detail) => {
        capturedDetail = detail;
      }
    });

    const text = JSON.stringify(capturedDetail);
    expect(text).toContain("analyzedCount");
    expect(text).not.toContain("candidates");
    expect(text.length).toBeLessThan(1500);
  });

  it("formats an enterprise wechat markdown daily report", () => {
    const markdown = buildDailyJobMarkdown({
      date: "2026-06-18",
      scanCompleted: true,
      scanBatches: 10,
      analyzedCount: 397,
      paperRan: true,
      tradeCount: 1,
      exposurePct: 2.88,
      startedAt: "2026-06-18T07:00:00.000Z",
      finishedAt: "2026-06-18T07:03:00.000Z",
      notificationSent: false
    });

    expect(markdown).toContain("明远交易系统日报");
    expect(markdown).toContain("扫描：397 只 / 10 批");
    expect(markdown).toContain("模拟盘：已执行");
    expect(markdown).toContain("当前仓位：2.88%");
  });

  it("sends enterprise wechat webhook payload", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    await sendWeComMarkdown("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test", "hello", async (url, init) => {
      capturedUrl = url;
      capturedBody = String(init.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ errcode: 0, errmsg: "ok" })
      };
    });

    expect(capturedUrl).toContain("qyapi.weixin.qq.com");
    expect(JSON.parse(capturedBody)).toEqual({
      msgtype: "markdown",
      markdown: { content: "hello" }
    });
  });
});
