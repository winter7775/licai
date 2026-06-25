import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperTradingPage } from "./PaperTradingPage";
import type { PaperTradingResponseDto } from "../live/liveTypes";
import type { RuleResult } from "../domain/types";

function rule(id: string, passed = true, severity: RuleResult["severity"] = "hard"): RuleResult {
  return {
    id,
    name: id,
    actual: passed ? "ok" : "偏离-1.2% / 量比0.96",
    threshold: "test",
    passed,
    severity,
    explanation: "test rule"
  };
}

function paperTradingFixture(): PaperTradingResponseDto {
  return {
    account: {
      initialCapital: 200000,
      cash: 184000,
      holdings: [
        {
          symbol: "600001",
          name: "测试银行",
          industry: "银行",
          quantity: 1000,
          avgCost: 10,
          stopPrice: 9.3,
          takeProfitPrice: 14,
          openedAt: "2026-06-25T07:10:00.000Z",
          updatedAt: "2026-06-25T07:10:00.000Z",
          reason: "A级买入：平台突破"
        }
      ],
      trades: [
        {
          id: "buy-1",
          side: "buy",
          symbol: "600001",
          name: "测试银行",
          industry: "银行",
          quantity: 1000,
          price: 10,
          stopPrice: 9.3,
          takeProfitPrice: 14,
          amount: 10000,
          reason: "A级买入：平台突破",
          tradedAt: "2026-06-25T07:10:00.000Z"
        },
        {
          id: "sell-1",
          side: "sell",
          symbol: "600003",
          name: "测试证券",
          industry: "证券",
          quantity: 500,
          price: 12,
          amount: 6000,
          realizedPnl: 1000,
          realizedPnlPct: 20,
          reason: "触发止盈",
          tradedAt: "2026-06-25T07:20:00.000Z"
        } as any
      ],
      reviews: [],
      updatedAt: "2026-06-25T07:20:00.000Z"
    },
    summary: {
      initialCapital: 200000,
      cash: 184000,
      marketValue: 11000,
      totalAssets: 195000,
      totalReturn: -5000,
      totalReturnPct: -2.5,
      exposurePct: 5.64,
      holdings: [
        {
          symbol: "600001",
          name: "测试银行",
          industry: "银行",
          quantity: 1000,
          avgCost: 10,
          currentPrice: 11,
          marketValue: 11000,
          costValue: 10000,
          unrealizedPnl: 1000,
          unrealizedPnlPct: 10,
          weightPct: 5.64,
          stopPrice: 9.3,
          takeProfitPrice: 14,
          openedAt: "2026-06-25T07:10:00.000Z",
          updatedAt: "2026-06-25T07:10:00.000Z",
          reason: "A级买入：平台突破"
        }
      ]
    },
    quoteStatus: {
      mode: "live",
      warnings: [],
      updatedAt: "2026-06-25T07:25:00.000Z"
    },
    scanState: {
      date: "2026-06-25",
      status: "complete",
      cursor: 800,
      batchSize: 40,
      dailyLimit: 800,
      universeCount: 5528,
      marketCapUniverseCount: 1659,
      prefilteredCount: 800,
      analyzedCount: 800,
      scanPolicy: {
        strategyVersion: "v3",
        marketCapTopPct: 30,
        initialPoolTarget: 800,
        dailyLimit: 800,
        batchSize: 40
      },
      updatedAt: "2026-06-25T07:20:00.000Z",
      warnings: [],
      candidates: [
        {
          symbol: "600001",
          name: "测试银行",
          industry: "银行",
          price: 11,
          signalType: "breakout",
          score: 92,
          stopPrice: 9.3,
          takeProfitPrice: 15.4,
          suggestedPositionPct: 6,
          hardRulesPassed: true,
          rules: [rule("trend.template"), rule("quality.valuation"), rule("relative_strength"), rule("buy.breakout", true, "info")]
        },
        {
          symbol: "600002",
          name: "测试药业",
          industry: "医药",
          price: 20,
          signalType: "watch",
          score: 86,
          stopPrice: 18.6,
          takeProfitPrice: 28,
          suggestedPositionPct: 0,
          hardRulesPassed: true,
          rules: [rule("trend.template"), rule("quality.valuation"), rule("relative_strength"), rule("buy.breakout", false, "info")]
        }
      ],
      attribution: {
        updatedAt: "2026-06-25T07:20:00.000Z",
        totalCandidates: 2,
        strictEligibleCount: 1,
        relaxedEligibleCount: 1,
        nearMissCount: 1,
        watchCount: 1,
        signalCount: 1,
        diagnosis: "test",
        ruleFailures: [],
        rejections: [
          {
            symbol: "600002",
            name: "测试药业",
            signalType: "watch",
            score: 86,
            price: 20,
            failedHardCount: 1,
            failedHardRules: ["平台突破"],
            failedHardRuleIds: ["buy.breakout"],
            relaxedEligible: true,
            reason: "Failed hard rules: 平台突破"
          }
        ]
      }
    },
    run: {
      trades: [],
      review: {
        id: "review-2026-06-25",
        date: "2026-06-25",
        actionSummary: "无新增交易",
        marketGate: "允许",
        targetExposurePct: 35,
        decisions: [],
        createdAt: "2026-06-25T07:20:00.000Z"
      },
      candidateDecisions: [
        { symbol: "600001", name: "测试银行", grade: "A", action: "skip", reason: "已持仓" },
        { symbol: "600002", name: "测试药业", grade: "B", action: "skip", reason: "本轮额度已被更高优先级候选占用" }
      ],
      scan: {
        provider: "eastmoney-public",
        tradeDate: "2026-06-25",
        universeCount: 5528,
        prefilteredCount: 800,
        analyzedCount: 800,
        candidateCount: 2,
        historyLimit: 800
      },
      position: {
        gate: { gate: "normal", label: "允许", reason: "test", riskMultiplier: 1, min: 25, max: 35 },
        source: { mode: "cached", file: "", refreshedAt: "", warnings: [] }
      }
    }
  };
}

describe("PaperTradingPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("separates strict buy candidates and near-buy candidates with execution decisions", () => {
    render(
      <PaperTradingPage
        paperTrading={paperTradingFixture()}
        loading={false}
        onRefresh={vi.fn()}
        onRun={vi.fn()}
        onRunScanBatch={vi.fn()}
      />
    );

    expect(screen.getByTestId("paper-strict-candidate-list")).toBeTruthy();
    expect(screen.getByTestId("paper-near-candidate-list")).toBeTruthy();
    expect(screen.getByTestId("paper-strict-candidate-600001").textContent).toContain("已持仓");
    expect(screen.getByTestId("paper-near-candidate-600002").textContent).toContain("本轮额度");
  });

  it("expands a holding to show chart area and symbol trade ledger", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          bars: [
            { date: "2026-06-23", open: 10, close: 10.5, high: 10.8, low: 9.9, volume: 1000000 },
            { date: "2026-06-24", open: 10.5, close: 11, high: 11.2, low: 10.3, volume: 1300000 }
          ]
        })
      }))
    );

    render(
      <PaperTradingPage
        paperTrading={paperTradingFixture()}
        loading={false}
        onRefresh={vi.fn()}
        onRun={vi.fn()}
        onRunScanBatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("paper-holding-row-600001"));

    expect(await screen.findByTestId("paper-holding-detail-600001")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("mini-kline-600001")).toBeTruthy());
    expect(screen.getByTestId("paper-holding-trades-600001").textContent).toContain("A级买入");
  });
});
