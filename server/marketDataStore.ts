import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DailyBar, SpotStock } from "../src/live/marketScreener";

export interface SpotSnapshot {
  updatedAt: string;
  total: number;
  stocks: SpotStock[];
}

export interface HistorySnapshot {
  updatedAt: string;
  symbol: string;
  provider: "tencent" | "eastmoney";
  bars: DailyBar[];
}

function normalizedSymbol(symbol: string): string {
  return symbol.replace(/\D/g, "").padStart(6, "0").slice(-6);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, "utf-8");
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code ?? "") : "";
    if (!new Set(["EEXIST", "EPERM"]).has(code)) throw error;
    await rm(filePath, { force: true });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function readSpotSnapshot(filePath: string): Promise<SpotSnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf-8")) as Partial<SpotSnapshot>;
    const stocks = Array.isArray(parsed.stocks) ? parsed.stocks : [];
    const total = Number(parsed.total ?? stocks.length);
    if (!Number.isFinite(total) || total <= 0 || stocks.length === 0) return null;
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      total,
      stocks
    };
  } catch {
    return null;
  }
}

export async function writeSpotSnapshot(filePath: string, snapshot: SpotSnapshot): Promise<void> {
  await writeJsonAtomic(filePath, snapshot);
}

function historySnapshotPath(directory: string, symbol: string): string {
  return path.join(directory, `${normalizedSymbol(symbol)}.json`);
}

export async function readHistorySnapshot(directory: string, symbol: string, limit: number): Promise<HistorySnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(historySnapshotPath(directory, symbol), "utf-8")) as Partial<HistorySnapshot>;
    const bars = Array.isArray(parsed.bars) ? parsed.bars : [];
    if (bars.length === 0) return null;
    const safeLimit = Math.max(1, Math.floor(Number(limit) || bars.length));
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      symbol: normalizedSymbol(parsed.symbol ?? symbol),
      provider: parsed.provider === "eastmoney" ? "eastmoney" : "tencent",
      bars: bars.slice(-safeLimit)
    };
  } catch {
    return null;
  }
}

export async function writeHistorySnapshot(
  directory: string,
  symbol: string,
  bars: DailyBar[],
  provider: HistorySnapshot["provider"]
): Promise<void> {
  if (bars.length === 0) return;
  await writeJsonAtomic(historySnapshotPath(directory, symbol), {
    updatedAt: new Date().toISOString(),
    symbol: normalizedSymbol(symbol),
    provider,
    bars
  } satisfies HistorySnapshot);
}
