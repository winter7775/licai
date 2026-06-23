import type { DailyBar, HistoryAnalysis, SpotStock } from "./marketScreener";
import type { PaperAttributionCandidate, PaperAttributionReport } from "../domain/paperAttribution";
import type { PaperAccount, PaperAccountSummary, PaperCandidateDecision, PaperDailyReview, PaperTrade } from "../domain/paperTrading";
import type { PortfolioState, PortfolioSummary } from "../domain/portfolio";
import type { PositionGateResult } from "../domain/types";
import type { PositionStatus } from "../domain/types";

export type ScanDepth = "quick" | "standard" | "deep";

export interface LiveScreenedStockDto {
  spot: SpotStock;
  history: DailyBar[];
  analysis: HistoryAnalysis;
  score: number;
}

export interface LiveScanResponseDto {
  provider: "eastmoney-public" | "sina-public" | "seed-public";
  sourceLabel: string;
  asOf: string;
  tradeDate: string;
  universeCount: number;
  marketCapUniverseCount?: number;
  marketCapTopPct?: number;
  initialPoolTarget?: number;
  prefilteredCount: number;
  analyzedCount: number;
  candidateCount: number;
  signalCount: number;
  watchCount: number;
  durationMs: number;
  candidates: LiveScreenedStockDto[];
  warnings: string[];
}

export interface LiveUiState {
  status: "loading" | "live" | "fallback";
  scan: LiveScanResponseDto | null;
  error: string | null;
}

export interface PortfolioResponseDto {
  portfolio: PortfolioState;
  summary: PortfolioSummary;
  quoteStatus: {
    mode: "live" | "fallback";
    warnings: string[];
    updatedAt: string;
  };
}

export interface PositionStatusResponseDto {
  status: PositionStatus;
  source: {
    mode: "refreshed" | "cached";
    file: string;
    refreshedAt: string;
    warnings: string[];
  };
  portfolio: PortfolioResponseDto;
}

export interface PaperScanStateDto {
  date: string;
  status: "idle" | "running" | "complete" | "error";
  cursor: number;
  batchSize: number;
  dailyLimit: number;
  universeCount: number;
  marketCapUniverseCount?: number;
  prefilteredCount: number;
  analyzedCount: number;
  scanPolicy?: {
    strategyVersion?: string;
    marketCapTopPct: number;
    initialPoolTarget: number;
    dailyLimit: number;
    batchSize: number;
  };
  updatedAt: string;
  warnings: string[];
  candidates: PaperAttributionCandidate[];
  attribution: PaperAttributionReport;
}

export interface PaperTradingResponseDto {
  account: PaperAccount;
  summary: PaperAccountSummary;
  quoteStatus: {
    mode: "live" | "fallback";
    warnings: string[];
    updatedAt: string;
  };
  scanState?: PaperScanStateDto;
  run?: {
    trades: PaperTrade[];
    review: PaperDailyReview;
    candidateDecisions?: PaperCandidateDecision[];
    scan: {
      provider: LiveScanResponseDto["provider"];
      tradeDate: string;
      universeCount: number;
      prefilteredCount: number;
      analyzedCount: number;
      candidateCount: number;
      historyLimit: number;
    };
    position: {
      gate: PositionGateResult;
      source: PositionStatusResponseDto["source"];
    };
  };
}
