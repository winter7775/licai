import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetPaperBackgroundScan, runPaperBackgroundScanStep, runPaperTradingCycle } from "./apiHandlers";

const DEFAULT_BATCH_SIZE = 40;
const DEFAULT_MAX_BATCHES = 10;
const LOG_DIR = path.resolve(process.cwd(), "output/logs");

type ScanStatus = "idle" | "running" | "complete" | "error";

interface ScanResponseLike {
  scanState?: {
    status?: ScanStatus | string;
    analyzedCount?: number;
    cursor?: number;
  };
}

interface PaperRunLike {
  run?: {
    trades?: unknown[];
  };
  summary?: {
    exposurePct?: number;
  };
}

export interface DailyJobSummary {
  date: string;
  scanCompleted: boolean;
  scanBatches: number;
  analyzedCount: number;
  paperRan: boolean;
  tradeCount: number;
  exposurePct: number | null;
  startedAt: string;
  finishedAt: string;
}

export interface DailyJobDeps {
  now: Date;
  batchSize: number;
  maxBatches: number;
  resetScan: () => Promise<ScanResponseLike>;
  scanStep: (batchSize: number) => Promise<ScanResponseLike>;
  runPaper: () => Promise<PaperRunLike>;
  writeLog: (summary: DailyJobSummary, detail: unknown) => Promise<void>;
}

function shanghaiDateString(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}

function isScanComplete(response: ScanResponseLike): boolean {
  return response.scanState?.status === "complete";
}

function analyzedCount(response: ScanResponseLike): number {
  return Number(response.scanState?.analyzedCount ?? response.scanState?.cursor ?? 0) || 0;
}

function compactDetail(step: string, response: ScanResponseLike | PaperRunLike) {
  if ("scanState" in response) {
    return {
      step,
      scanState: {
        status: response.scanState?.status ?? "unknown",
        analyzedCount: response.scanState?.analyzedCount ?? 0,
        cursor: response.scanState?.cursor ?? 0
      }
    };
  }

  return {
    step,
    paper: {
      tradeCount: response.run?.trades?.length ?? 0,
      exposurePct: response.summary?.exposurePct ?? null
    }
  };
}

export async function writeDailyJobLog(summary: DailyJobSummary, detail: unknown): Promise<void> {
  await mkdir(LOG_DIR, { recursive: true });
  const jsonPath = path.join(LOG_DIR, `daily-job-${summary.date}.json`);
  const textPath = path.join(LOG_DIR, `daily-job-${summary.date}.txt`);
  await writeFile(jsonPath, `${JSON.stringify({ summary, detail }, null, 2)}\n`, "utf-8");
  await writeFile(
    textPath,
    [
      `date: ${summary.date}`,
      `scanCompleted: ${summary.scanCompleted}`,
      `scanBatches: ${summary.scanBatches}`,
      `analyzedCount: ${summary.analyzedCount}`,
      `paperRan: ${summary.paperRan}`,
      `tradeCount: ${summary.tradeCount}`,
      `exposurePct: ${summary.exposurePct ?? "unknown"}`,
      `startedAt: ${summary.startedAt}`,
      `finishedAt: ${summary.finishedAt}`
    ].join("\n") + "\n",
    "utf-8"
  );
}

function defaultDeps(input?: Partial<DailyJobDeps>): DailyJobDeps {
  return {
    now: input?.now ?? new Date(),
    batchSize: input?.batchSize ?? DEFAULT_BATCH_SIZE,
    maxBatches: input?.maxBatches ?? DEFAULT_MAX_BATCHES,
    resetScan: input?.resetScan ?? (() => resetPaperBackgroundScan() as Promise<ScanResponseLike>),
    scanStep:
      input?.scanStep ??
      ((batchSize: number) =>
        runPaperBackgroundScanStep(new URL(`http://127.0.0.1/api/paper-trading/background-scan/step?batch=${batchSize}`)) as Promise<ScanResponseLike>),
    runPaper: input?.runPaper ?? (() => runPaperTradingCycle({ force: true }) as Promise<PaperRunLike>),
    writeLog: input?.writeLog ?? writeDailyJobLog
  };
}

export async function runDailyJob(input?: Partial<DailyJobDeps>): Promise<DailyJobSummary> {
  const deps = defaultDeps(input);
  const startedAt = deps.now.toISOString();
  const date = shanghaiDateString(deps.now);
  const details: unknown[] = [];
  let scanResponse = await deps.resetScan();
  details.push(compactDetail("resetScan", scanResponse));
  let scanBatches = 0;

  while (!isScanComplete(scanResponse) && scanBatches < deps.maxBatches) {
    scanResponse = await deps.scanStep(deps.batchSize);
    details.push(compactDetail("scanStep", scanResponse));
    scanBatches += 1;
  }

  let paperResponse: PaperRunLike | null = null;
  if (isScanComplete(scanResponse)) {
    paperResponse = await deps.runPaper();
    details.push(compactDetail("runPaper", paperResponse));
  }

  const summary: DailyJobSummary = {
    date,
    scanCompleted: isScanComplete(scanResponse),
    scanBatches,
    analyzedCount: analyzedCount(scanResponse),
    paperRan: paperResponse !== null,
    tradeCount: paperResponse?.run?.trades?.length ?? 0,
    exposurePct: paperResponse?.summary?.exposurePct ?? null,
    startedAt,
    finishedAt: new Date().toISOString()
  };
  await deps.writeLog(summary, details);
  return summary;
}

function isMainModule(): boolean {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) {
  runDailyJob()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    });
}
