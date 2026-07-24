import { describe, expect, it } from "vitest";
import { buildDailyJobMarkdown, runDailyJob, sendWeComMarkdown } from "./dailyJob";

describe("daily cloud job", () => {
  it("runs scan batches until complete then runs paper trading", async () => {
    const calls: string[] = [];
    let step = 0;

    const result = await runDailyJob({
      now: new Date("2026-06-18T17:10:00+08:00"),
      maxBatches: 3,
      loadScan: async () => {
        calls.push("load");
        return { scanState: { date: "2026-06-18", status: "idle", analyzedCount: 0, cursor: 0 } };
      },
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
        return {
          run: {
            beforeSummary: {
              totalAssets: 200100,
              holdings: [{ symbol: "600001", name: "测试持仓", quantity: 100, todayPnl: 100, todayPnlPct: 1 }]
            },
            trades: [{ side: "buy", symbol: "600000", name: "浦发银行", quantity: 100, price: 10, amount: 1000, reason: "测试买入" }]
          },
          summary: {
            cash: 199000,
            marketValue: 1100,
            totalAssets: 200100,
            totalReturn: 100,
            totalReturnPct: 0.05,
            exposurePct: 0.55,
            holdings: [
              {
                symbol: "600000",
                name: "浦发银行",
                quantity: 100,
                avgCost: 10,
                currentPrice: 11,
                marketValue: 1100,
                unrealizedPnl: 100,
                unrealizedPnlPct: 10,
                weightPct: 0.55
              }
            ]
          },
          quoteStatus: { mode: "live", warnings: [] }
        };
      },
      notify: async () => {
        calls.push("notify");
        return true;
      },
      writeLog: async () => {
        calls.push("log");
      }
    });

    expect(calls).toEqual(["load", "reset", "scan", "scan", "paper", "notify", "log"]);
    expect(result.scanCompleted).toBe(true);
    expect(result.paperRan).toBe(true);
    expect(result.tradeCount).toBe(1);
    expect(result.paper?.dailyPnl).toBe(100);
    expect(result.paper?.holdings[0].symbol).toBe("600000");
    expect(result.notificationSent).toBe(true);
  });

  it("reuses an already completed same-day scan instead of resetting and rescanning", async () => {
    const calls: string[] = [];

    const result = await runDailyJob({
      now: new Date("2026-06-18T17:10:00+08:00"),
      loadScan: async () => {
        calls.push("load");
        return {
          scanState: {
            date: "2026-06-18",
            status: "complete",
            analyzedCount: 397,
            cursor: 400,
            attribution: { strictEligibleCount: 0, nearMissCount: 1 }
          }
        };
      },
      resetScan: async () => {
        calls.push("reset");
        return { scanState: { status: "running", analyzedCount: 0, cursor: 0 } };
      },
      scanStep: async () => {
        calls.push("scan");
        return { scanState: { status: "complete", analyzedCount: 40, cursor: 40 } };
      },
      runPaper: async () => {
        calls.push("paper");
        return {
          run: {
            beforeSummary: {
              totalAssets: 200350,
              holdings: [{ symbol: "600000", name: "浦发银行", quantity: 100, todayPnl: 350, todayPnlPct: 3.5 }]
            },
            trades: [],
            review: { decisions: ["本轮没有符合硬性交易规则的标的，未强行建仓。"] }
          },
          summary: {
            totalAssets: 200350,
            totalReturn: 350,
            totalReturnPct: 0.18,
            exposurePct: 5,
            holdings: [
              {
                symbol: "600000",
                name: "浦发银行",
                quantity: 100,
                avgCost: 10,
                currentPrice: 13.5,
                marketValue: 1350,
                todayPnl: 350,
                todayPnlPct: 3.5,
                unrealizedPnl: 350,
                unrealizedPnlPct: 35,
                weightPct: 0.67
              }
            ]
          },
          quoteStatus: { mode: "live", warnings: [] }
        };
      },
      notify: async () => {
        calls.push("notify");
        return true;
      },
      writeLog: async () => {
        calls.push("log");
      }
    });

    expect(calls).toEqual(["load", "paper", "notify", "log"]);
    expect(result.scanCompleted).toBe(true);
    expect(result.scanBatches).toBe(0);
    expect(result.analyzedCount).toBe(397);
    expect(result.strictEligibleCount).toBe(0);
    expect(result.nearMissCount).toBe(1);
    expect(result.paper?.dailyPnl).toBe(350);
    expect(result.paper?.dailyPnlPct).toBe(0.18);
    expect(result.paper?.noTradeReasons).toContain("按本轮有效行情，当前持仓未触发系统退出条件");
    expect(result.paper?.noTradeReasons).toContain("本轮没有符合硬性交易规则的标的，未强行建仓。");
    const markdown = buildDailyJobMarkdown(result);
    expect(markdown).toContain("买点：严格可买 0 只 / 接近可买 1 只");
    expect(markdown).toContain("原因：按本轮有效行情，当前持仓未触发系统退出条件");
  });

  it("reports unknown daily pnl when holding-level previous-close data is missing", async () => {
    const result = await runDailyJob({
      now: new Date("2026-06-18T17:10:00+08:00"),
      loadScan: async () => ({ scanState: { date: "2026-06-18", status: "complete", analyzedCount: 400 } }),
      runPaper: async () => ({
        run: {
          beforeSummary: { totalAssets: 200000 },
          beforeQuoteStatus: { mode: "fallback", warnings: ["昨收数据缺失"] },
          trades: []
        },
        summary: {
          totalAssets: 200000,
          totalReturn: 0,
          totalReturnPct: 0,
          exposurePct: 5,
          holdings: [{ symbol: "600000", name: "浦发银行", quantity: 100, todayPnl: null }]
        },
        quoteStatus: { mode: "live", warnings: [] }
      }),
      notify: async () => false,
      writeLog: async () => undefined
    });

    expect(result.paper?.dailyPnl).toBeNull();
    expect(result.paper?.dailyPnlPct).toBeNull();
    expect(result.paper?.noTradeReasons).toContain("持仓行情不完整，退出条件未完整校验");
    expect(buildDailyJobMarkdown(result)).toContain("今日盈亏：未知 / 未知");
  });

  it("reports the real skip reason when a strict candidate is not bought", async () => {
    const result = await runDailyJob({
      now: new Date("2026-06-18T17:10:00+08:00"),
      loadScan: async () => ({
        scanState: {
          date: "2026-06-18",
          status: "complete",
          analyzedCount: 400,
          attribution: { strictEligibleCount: 1, nearMissCount: 0 }
        }
      }),
      runPaper: async () => ({
        run: {
          beforeSummary: { totalAssets: 200000, holdings: [] },
          trades: [],
          candidateDecisions: [
            { symbol: "600000", name: "浦发银行", grade: "A", action: "skip", reason: "市场仓位上限不足" },
            { symbol: "000001", name: "平安银行", grade: "B", action: "skip", reason: "V4 已关闭 B 级试错" },
            { symbol: "000002", name: "万科A", grade: "B", action: "skip", reason: "V4 已关闭 B 级试错" }
          ],
          review: { decisions: ["本轮没有符合硬性交易规则的标的，未强行建仓。"] }
        },
        summary: { totalAssets: 200000, totalReturn: 0, totalReturnPct: 0, exposurePct: 100, holdings: [] },
        quoteStatus: { mode: "live", warnings: [] }
      }),
      notify: async () => false,
      writeLog: async () => undefined
    });

    expect(result.paper?.noTradeReasons).toContain("候选未执行：市场仓位上限不足（1只）");
    expect(result.paper?.noTradeReasons).not.toContain("候选未执行：V4 已关闭 B 级试错（2只）");
    expect(result.paper?.noTradeReasons).not.toContain("本轮没有符合硬性交易规则的标的，未强行建仓。");
  });

  it("reports a same-day repeat as skipped without reusing old trade decisions", async () => {
    const result = await runDailyJob({
      now: new Date("2026-06-18T17:10:00+08:00"),
      loadScan: async () => ({
        scanState: {
          date: "2026-06-18",
          status: "complete",
          analyzedCount: 400,
          attribution: { strictEligibleCount: 1, nearMissCount: 0 }
        }
      }),
      runPaper: async () => ({
        run: {
          beforeSummary: { totalAssets: 201000, holdings: [] },
          beforeQuoteStatus: { mode: "live", warnings: [] },
          trades: [],
          skipped: true,
          skipReason: "paper trading already reviewed for this date",
          review: { decisions: ["600000 浦发银行：已按严格规则模拟买入"] },
          candidateDecisions: [{ symbol: "600000", name: "浦发银行", grade: "A", action: "buy", reason: "严格规则通过" }]
        },
        summary: { totalAssets: 201000, totalReturn: 1000, totalReturnPct: 0.5, exposurePct: 10, holdings: [] },
        quoteStatus: { mode: "live", warnings: [] }
      }),
      notify: async () => false,
      writeLog: async () => undefined
    });

    expect(result.paper?.noTradeReasons).toEqual(["本交易日已完成模拟复盘，未重复执行交易"]);
    expect(result.paper?.noTradeReasons).not.toContain("600000 浦发银行：已按严格规则模拟买入");
  });

  it("writes compact log details instead of full scan candidate payloads", async () => {
    let capturedDetail: unknown = null;

    await runDailyJob({
      now: new Date("2026-06-18T17:10:00+08:00"),
      maxBatches: 1,
      loadScan: async () => ({ scanState: { date: "2026-06-18", status: "idle", analyzedCount: 0 } }),
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

  it("includes paper account pnl, holdings, and trade details in the daily report", () => {
    const markdown = buildDailyJobMarkdown({
      date: "2026-06-18",
      scanCompleted: true,
      scanBatches: 10,
      analyzedCount: 397,
      paperRan: true,
      tradeCount: 1,
      exposurePct: 8.4,
      startedAt: "2026-06-18T07:00:00.000Z",
      finishedAt: "2026-06-18T07:03:00.000Z",
      notificationSent: false,
      paper: {
        totalAssets: 201250,
        cash: 184400,
        marketValue: 16850,
        totalReturn: 1250,
        totalReturnPct: 0.63,
        exposurePct: 8.4,
        dailyPnl: 350,
        dailyPnlPct: 0.17,
        quoteMode: "live",
        quoteWarnings: [],
        noTradeReasons: [],
        holdings: [
          {
            symbol: "600961",
            name: "株冶集团",
            quantity: 200,
            avgCost: 28.27,
            currentPrice: 29.1,
            marketValue: 5820,
            todayPnl: 80,
            todayPnlPct: 1.39,
            unrealizedPnl: 166,
            unrealizedPnlPct: 2.94,
            weightPct: 2.89
          }
        ],
        trades: [
          {
            side: "buy",
            symbol: "600961",
            name: "株冶集团",
            quantity: 200,
            price: 28.27,
            amount: 5654,
            reason: "B级试错"
          }
        ]
      }
    });

    expect(markdown).toContain("账户概览");
    expect(markdown).toContain("总资产：201,250");
    expect(markdown).toContain("今日盈亏：+350");
    expect(markdown).toContain("累计盈亏：+1,250 / +0.63%");
    expect(markdown).toContain("当前持仓");
    expect(markdown).toContain("600961 株冶集团");
    expect(markdown).toContain("今日 +80 / +1.39%");
    expect(markdown).toContain("浮盈亏 +166 / +2.94%");
    expect(markdown).toContain("今日交易");
    expect(markdown).toContain("买入 600961 株冶集团");
    expect(markdown).toContain("金额 5,654");
    expect(markdown).toContain("B级试错");
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
