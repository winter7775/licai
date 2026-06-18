import { applyResolvedGateToCandidate } from "../domain/positionControl";
import { calculatePositionSizePct, calculateTakeProfitPlan, scoreSignalRules } from "../domain/ruleEngine";
import { defaultStrategyParams } from "../domain/strategyParams";
import type { PositionStatus, RuleResult, SignalCandidate } from "../domain/types";
import { positionStatus } from "../data/demoData";
import type { LiveScanResponseDto, LiveScreenedStockDto, PaperTradingResponseDto, PositionStatusResponseDto } from "./liveTypes";

function signalLabel(type: LiveScreenedStockDto["analysis"]["signalType"]): string {
  if (type === "breakout") return "平台突破";
  if (type === "pullback") return "突破回踩";
  return "候选观察";
}

export function mapLiveCandidate(item: LiveScreenedStockDto, activePosition: PositionStatus = positionStatus): SignalCandidate {
  const marketGateRule: RuleResult = {
    id: "market.position_gate",
    name: "组合仓位闸门",
    actual: activePosition.finalGate.label,
    threshold: "允许开新仓",
    passed: activePosition.finalGate.gate !== "blocked" && activePosition.finalGate.gate !== "watch_only",
    severity: "hard",
    explanation: activePosition.finalGate.reason
  };
  const rules = [marketGateRule, ...item.analysis.rules];
  const suggestedPositionPct = calculatePositionSizePct({
    accountRiskPct: defaultStrategyParams.stock.accountRiskPct,
    stopLossWidthPct: item.analysis.stopLossWidthPct,
    maxSinglePositionPct: defaultStrategyParams.stock.maxSinglePositionPct,
    riskMultiplier: activePosition.finalGate.riskMultiplier
  });
  const base: SignalCandidate = {
    id: `live-${item.spot.symbol}`,
    symbol: item.spot.symbol,
    name: item.spot.name,
    industry: item.spot.industry,
    signalType: item.analysis.signalType,
    signalLabel: signalLabel(item.analysis.signalType),
    entryPrice: item.spot.price,
    lastClose: item.history[item.history.length - 1]?.close ?? item.spot.price,
    pivotPrice: item.analysis.pivotPrice,
    stopPrice: item.analysis.stopPrice,
    stopLossWidthPct: item.analysis.stopLossWidthPct,
    takeProfitMain: calculateTakeProfitPlan(item.spot.price).mainTarget,
    suggestedPositionPct,
    tradability: item.analysis.signalType === "watch" ? "不可买" : "可买",
    gate: "normal",
    gateReason: "",
    rules,
    tags: [
      "真实行情",
      item.analysis.signalType === "breakout" ? "突破" : item.analysis.signalType === "pullback" ? "回踩" : "观察",
      `PE ${item.spot.peTtm.toFixed(1)}`
    ],
    sparkline: item.history.slice(-20).map((bar) => bar.close),
    score: scoreSignalRules({ rules })
  };
  const gated = applyResolvedGateToCandidate(base, activePosition.finalGate);
  const nonMarketHardFail = item.analysis.rules.some((rule) => rule.severity === "hard" && !rule.passed);

  return {
    ...gated,
    tradability: nonMarketHardFail || item.analysis.signalType === "watch" ? "不可买" : gated.tradability
  };
}

export interface FetchLiveScanOptions {
  force?: boolean;
  historyLimit?: number;
}

function normalizeLiveScanOptions(options: FetchLiveScanOptions | boolean): FetchLiveScanOptions {
  return typeof options === "boolean" ? { force: options } : options;
}

export async function fetchLiveScan(options: FetchLiveScanOptions | boolean = false): Promise<LiveScanResponseDto> {
  const normalized = normalizeLiveScanOptions(options);
  const params = new URLSearchParams({ scan: "full", display: "10" });
  if (Number.isFinite(normalized.historyLimit)) params.set("history", String(normalized.historyLimit));
  if (normalized.force) params.set("refresh", "1");
  const response = await fetch(`/api/live/screen?${params.toString()}`);
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `真实行情接口返回 HTTP ${response.status}`);
  }
  return (await response.json()) as LiveScanResponseDto;
}

export function mapLiveScanSignals(scan: LiveScanResponseDto, activePosition: PositionStatus = positionStatus): SignalCandidate[] {
  return scan.candidates.map((candidate) => mapLiveCandidate(candidate, activePosition));
}

export async function fetchPositionStatus(force = false): Promise<PositionStatusResponseDto> {
  const response = await fetch(`/api/live/position-status${force ? "?refresh=1" : ""}`);
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `仓位状态接口返回 HTTP ${response.status}`);
  }
  return (await response.json()) as PositionStatusResponseDto;
}

export async function fetchPaperTrading(): Promise<PaperTradingResponseDto> {
  const response = await fetch("/api/paper-trading");
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `模拟盘接口返回 HTTP ${response.status}`);
  }
  return (await response.json()) as PaperTradingResponseDto;
}

export async function runPaperTrading(force = false): Promise<PaperTradingResponseDto> {
  const response = await fetch(`/api/paper-trading/run${force ? "?refresh=1" : ""}`, { method: "POST" });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `模拟盘自动交易返回 HTTP ${response.status}`);
  }
  return (await response.json()) as PaperTradingResponseDto;
}

export async function runPaperTradingScanBatch(options: { batchSize?: number } = {}): Promise<PaperTradingResponseDto> {
  const params = new URLSearchParams();
  if (Number.isFinite(options.batchSize)) params.set("batch", String(options.batchSize));
  const query = params.toString();
  const response = await fetch(`/api/paper-trading/background-scan/step${query ? `?${query}` : ""}`, { method: "POST" });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `妯℃嫙鐩樺悗鍙版壂鎻忚繑鍥?HTTP ${response.status}`);
  }
  return (await response.json()) as PaperTradingResponseDto;
}
