import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildPaperAttribution,
  type PaperAttributionCandidate,
  type PaperAttributionReport
} from "../src/domain/paperAttribution";
import type { LiveScanResponse, LiveScreenedStock } from "./eastmoneyProvider";

export type PaperScanStatus = "idle" | "running" | "complete" | "error";
const PAPER_SCAN_STRATEGY_VERSION = "v3";

export interface PaperScanState {
  date: string;
  status: PaperScanStatus;
  cursor: number;
  batchSize: number;
  dailyLimit: number;
  universeCount: number;
  marketCapUniverseCount: number;
  prefilteredCount: number;
  analyzedCount: number;
  scanPolicy: {
    strategyVersion: string;
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

export interface CreatePaperScanStateInput {
  date: string;
  batchSize: number;
  dailyLimit: number;
  marketCapTopPct?: number;
  initialPoolTarget?: number;
  now?: string;
}

function boundedInteger(value: number, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value));
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, min), max);
}

function uniqueWarnings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, 20);
}

export function createPaperScanState(input: CreatePaperScanStateInput): PaperScanState {
  const now = input.now ?? new Date().toISOString();
  const batchSize = boundedInteger(input.batchSize, 40, 1, 100);
  const initialPoolTarget = boundedInteger(input.initialPoolTarget ?? 800, 800, 300, 800);
  const dailyLimit = boundedInteger(input.dailyLimit, initialPoolTarget, batchSize, initialPoolTarget);
  const marketCapTopPct = boundedInteger(input.marketCapTopPct ?? 30, 30, 1, 100);
  return {
    date: input.date,
    status: "idle",
    cursor: 0,
    batchSize,
    dailyLimit,
    universeCount: 0,
    marketCapUniverseCount: 0,
    prefilteredCount: 0,
    analyzedCount: 0,
    scanPolicy: {
      strategyVersion: PAPER_SCAN_STRATEGY_VERSION,
      marketCapTopPct,
      initialPoolTarget,
      dailyLimit,
      batchSize
    },
    updatedAt: now,
    warnings: [],
    candidates: [],
    attribution: buildPaperAttribution([], now)
  };
}

export function paperAttributionCandidateFromLiveStock(item: LiveScreenedStock): PaperAttributionCandidate {
  return {
    symbol: item.spot.symbol,
    name: item.spot.name,
    industry: item.spot.industry,
    price: item.spot.price,
    signalType: item.analysis.signalType,
    score: item.score,
    stopPrice: item.analysis.stopPrice,
    takeProfitPrice: Number((item.spot.price * 1.4).toFixed(2)),
    suggestedPositionPct: item.analysis.signalType === "watch" ? 0 : Math.min(10, Math.max(0, 7 - item.analysis.stopLossWidthPct) + 4),
    hardRulesPassed: !item.analysis.rules.some((rule) => (rule.severity ?? "soft") === "hard" && !rule.passed),
    rules: item.analysis.rules
  };
}

function mergeCandidates(
  current: PaperAttributionCandidate[],
  incoming: PaperAttributionCandidate[]
): PaperAttributionCandidate[] {
  const bySymbol = new Map(current.map((candidate) => [candidate.symbol, candidate]));
  for (const candidate of incoming) {
    bySymbol.set(candidate.symbol, candidate);
  }
  return Array.from(bySymbol.values()).sort((left, right) => right.score - left.score).slice(0, 800);
}

export function mergePaperScanBatch(state: PaperScanState, scan: LiveScanResponse, requestedBatchSize = state.batchSize): PaperScanState {
  const now = new Date().toISOString();
  const batchSize = boundedInteger(requestedBatchSize, state.batchSize, 1, 100);
  const nextCursor = Math.min(state.cursor + batchSize, scan.prefilteredCount || state.prefilteredCount || state.dailyLimit, state.dailyLimit);
  const candidates = mergeCandidates(state.candidates, scan.candidates.map(paperAttributionCandidateFromLiveStock));
  const complete = nextCursor >= Math.min(scan.prefilteredCount || nextCursor, state.dailyLimit);

  return {
    ...state,
    status: complete ? "complete" : "running",
    cursor: nextCursor,
    batchSize,
    universeCount: scan.universeCount || state.universeCount,
    marketCapUniverseCount: scan.marketCapUniverseCount ?? state.marketCapUniverseCount,
    prefilteredCount: scan.prefilteredCount || state.prefilteredCount,
    analyzedCount: state.analyzedCount + scan.analyzedCount,
    updatedAt: now,
    warnings: uniqueWarnings([...state.warnings, ...scan.warnings]),
    candidates,
    attribution: buildPaperAttribution(candidates, now)
  };
}

export function markPaperScanError(state: PaperScanState, message: string): PaperScanState {
  const now = new Date().toISOString();
  return {
    ...state,
    status: "error",
    updatedAt: now,
    warnings: uniqueWarnings([message, ...state.warnings])
  };
}

export async function readPaperScanState(filePath: string, fallback: CreatePaperScanStateInput): Promise<PaperScanState> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as PaperScanState;
    const expected = createPaperScanState(fallback);
    if (
      parsed.date === fallback.date &&
      parsed.scanPolicy?.strategyVersion === expected.scanPolicy.strategyVersion &&
      parsed.scanPolicy?.marketCapTopPct === expected.scanPolicy.marketCapTopPct &&
      parsed.scanPolicy?.initialPoolTarget === expected.scanPolicy.initialPoolTarget &&
      (parsed.universeCount === 0 || parsed.universeCount >= 1000)
    ) {
      return parsed;
    }
  } catch {
    // Missing or stale scan state starts a new daily pass.
  }
  return createPaperScanState(fallback);
}

export async function writePaperScanState(filePath: string, state: PaperScanState): Promise<PaperScanState> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
  return state;
}
