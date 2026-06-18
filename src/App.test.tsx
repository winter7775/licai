import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getPositionStatus } from "./data/apiClient";
import type { LiveScanResponseDto, PositionStatusResponseDto } from "./live/liveTypes";

const liveAdapterMocks = vi.hoisted(() => ({
  fetchLiveScan: vi.fn(),
  fetchPaperTrading: vi.fn(),
  fetchPositionStatus: vi.fn(),
  mapLiveScanSignals: vi.fn(() => []),
  runPaperTrading: vi.fn(),
  runPaperTradingScanBatch: vi.fn()
}));

vi.mock("./live/liveAdapter", () => liveAdapterMocks);

function emptyScan(): LiveScanResponseDto {
  return {
    provider: "eastmoney-public",
    sourceLabel: "东方财富公开行情接口",
    asOf: "2026-06-08T09:30:00.000Z",
    tradeDate: "2026-06-05",
    universeCount: 5532,
    prefilteredCount: 10,
    analyzedCount: 10,
    candidateCount: 0,
    signalCount: 0,
    watchCount: 0,
    durationMs: 100,
    candidates: [],
    warnings: []
  };
}

function positionResponse(): PositionStatusResponseDto {
  return {
    status: getPositionStatus(),
    source: {
      mode: "cached",
      file: "quant/signals/2026-06-03-market-cycle-position.json",
      refreshedAt: "2026-06-08T09:30:00.000Z",
      warnings: []
    },
    portfolio: {
      portfolio: {
        accountEquity: 0,
        cash: 0,
        holdings: []
      },
      summary: {
        accountEquity: 0,
        cash: 0,
        marketValue: 0,
        totalCost: 0,
        unrealizedPnl: 0,
        exposurePct: 0,
        singleNameMaxPct: 0,
        holdings: []
      },
      quoteStatus: {
        mode: "fallback",
        warnings: [],
        updatedAt: "2026-06-08T09:30:00.000Z"
      }
    }
  };
}

function paperTradingResponse() {
  return {
    account: {
      initialCapital: 200000,
      cash: 200000,
      holdings: [],
      trades: [],
      reviews: [],
      updatedAt: "2026-06-09T09:30:00.000Z"
    },
    summary: {
      initialCapital: 200000,
      cash: 200000,
      marketValue: 0,
      totalAssets: 200000,
      totalReturn: 0,
      totalReturnPct: 0,
      exposurePct: 0,
      holdings: []
    },
    quoteStatus: {
      mode: "live",
      warnings: [],
      updatedAt: "2026-06-09T09:30:00.000Z"
    }
  };
}

function paperTradingResponseWithAttribution() {
  return {
    ...paperTradingResponse(),
    scanState: {
      date: "2026-06-10",
      status: "running",
      cursor: 40,
      batchSize: 40,
      dailyLimit: 300,
      universeCount: 5532,
      marketCapUniverseCount: 1659,
      prefilteredCount: 120,
      analyzedCount: 40,
      scanPolicy: {
        marketCapTopPct: 30,
        initialPoolTarget: 400,
        dailyLimit: 300,
        batchSize: 40
      },
      updatedAt: "2026-06-10T09:40:00.000Z",
      warnings: [],
      candidates: [],
      attribution: {
        updatedAt: "2026-06-10T09:40:00.000Z",
        totalCandidates: 1,
        strictEligibleCount: 0,
        relaxedEligibleCount: 1,
        nearMissCount: 1,
        watchCount: 1,
        signalCount: 0,
        diagnosis: "No strict buy candidate yet.",
        ruleFailures: [
          {
            id: "buy.breakout",
            name: "breakout",
            severity: "hard",
            failedCount: 1,
            sampleActuals: ["extension -2%"],
            sampleSymbols: ["600001"]
          }
        ],
        rejections: [
          {
            symbol: "600001",
            name: "A",
            signalType: "watch",
            score: 80,
            price: 10,
            failedHardCount: 1,
            failedHardRules: ["breakout"],
            relaxedEligible: true,
            reason: "Failed hard rules: breakout"
          }
        ]
      }
    }
  };
}

describe("App startup data loading", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the market sentiment and position status on startup while loading a small live scan", async () => {
    liveAdapterMocks.fetchPositionStatus.mockResolvedValue(positionResponse());
    liveAdapterMocks.fetchLiveScan.mockResolvedValue(emptyScan());
    liveAdapterMocks.fetchPaperTrading.mockResolvedValue(paperTradingResponse());

    render(<App />);

    await waitFor(() => expect(liveAdapterMocks.fetchPositionStatus).toHaveBeenCalledWith(true));
    expect(liveAdapterMocks.fetchLiveScan).toHaveBeenCalledWith({ force: false, historyLimit: 20 });
    expect(liveAdapterMocks.fetchPaperTrading).toHaveBeenCalled();
  });

  it("refreshes with the selected standard scan depth", async () => {
    liveAdapterMocks.fetchPositionStatus.mockResolvedValue(positionResponse());
    liveAdapterMocks.fetchLiveScan.mockResolvedValue(emptyScan());
    liveAdapterMocks.fetchPaperTrading.mockResolvedValue(paperTradingResponse());

    render(<App />);

    await waitFor(() => expect(liveAdapterMocks.fetchLiveScan).toHaveBeenCalledWith({ force: false, historyLimit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "标准" }));

    await waitFor(() => expect(liveAdapterMocks.fetchLiveScan).toHaveBeenCalledWith({ force: true, historyLimit: 80 }));
  });

  it("runs automatic paper trading from the paper trading page", async () => {
    liveAdapterMocks.fetchPositionStatus.mockResolvedValue(positionResponse());
    liveAdapterMocks.fetchLiveScan.mockResolvedValue(emptyScan());
    liveAdapterMocks.fetchPaperTrading.mockResolvedValue(paperTradingResponse());
    liveAdapterMocks.runPaperTrading.mockResolvedValue(paperTradingResponse());

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "模拟盘" }));
    fireEvent.click(await screen.findByRole("button", { name: "自动运行" }));

    await waitFor(() => expect(liveAdapterMocks.runPaperTrading).toHaveBeenCalledWith(true));
  });

  it("shows paper buy attribution and runs a background scan batch from the paper page", async () => {
    liveAdapterMocks.fetchPositionStatus.mockResolvedValue(positionResponse());
    liveAdapterMocks.fetchLiveScan.mockResolvedValue(emptyScan());
    liveAdapterMocks.fetchPaperTrading.mockResolvedValue(paperTradingResponseWithAttribution());
    liveAdapterMocks.runPaperTradingScanBatch
      .mockResolvedValueOnce(paperTradingResponseWithAttribution())
      .mockResolvedValueOnce({
        ...paperTradingResponseWithAttribution(),
        scanState: {
          ...paperTradingResponseWithAttribution().scanState,
          status: "complete",
          cursor: 400,
          prefilteredCount: 400,
          analyzedCount: 400
        }
      });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "模拟盘" }));

    expect(await screen.findByTestId("paper-attribution-panel")).toBeTruthy();
    expect(await screen.findByTestId("paper-scan-policy")).toBeTruthy();
    fireEvent.click(screen.getByTestId("paper-scan-step-button"));

    await waitFor(() => expect(liveAdapterMocks.runPaperTradingScanBatch).toHaveBeenCalledTimes(2));
    expect(liveAdapterMocks.runPaperTradingScanBatch).toHaveBeenCalledWith({ batchSize: 40 });
  });
});
