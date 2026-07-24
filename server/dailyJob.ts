import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPaperBackgroundScan, resetPaperBackgroundScan, runPaperBackgroundScanStep, runPaperTradingCycle } from "./apiHandlers";
import { runWithOperationLock } from "./operationLock";

const DEFAULT_BATCH_SIZE = 40;
const DEFAULT_MAX_BATCHES = 20;
const LOG_DIR = path.resolve(process.cwd(), "output/logs");

type ScanStatus = "idle" | "running" | "complete" | "error";

interface ScanResponseLike {
  scanState?: {
    date?: string;
    status?: ScanStatus | string;
    analyzedCount?: number;
    cursor?: number;
    attribution?: {
      strictEligibleCount?: number;
      nearMissCount?: number;
      diagnosis?: string;
    };
  };
}

interface PaperRunLike {
  run?: {
    trades?: PaperTradeLike[];
    beforeSummary?: PaperSummaryLike;
    beforeQuoteStatus?: {
      mode?: string;
      warnings?: string[];
    };
    skipped?: boolean;
    skipReason?: string;
    review?: {
      decisions?: string[];
    };
    candidateDecisions?: Array<{
      grade?: string;
      action?: string;
      reason?: string;
    }>;
  };
  summary?: PaperSummaryLike;
  quoteStatus?: {
    mode?: string;
    warnings?: string[];
  };
}

interface PaperSummaryLike {
  cash?: number;
  marketValue?: number;
  totalAssets?: number;
  totalReturn?: number;
  totalReturnPct?: number;
  exposurePct?: number;
  holdings?: PaperHoldingLike[];
}

interface PaperHoldingLike {
  symbol?: string;
  name?: string;
  quantity?: number;
  avgCost?: number;
  currentPrice?: number;
  marketValue?: number;
  todayPnl?: number | null;
  todayPnlPct?: number | null;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
  weightPct?: number;
}

interface PaperTradeLike {
  side?: string;
  symbol?: string;
  name?: string;
  quantity?: number;
  price?: number;
  amount?: number;
  reason?: string;
}

export interface DailyPaperReport {
  totalAssets: number | null;
  cash: number | null;
  marketValue: number | null;
  totalReturn: number | null;
  totalReturnPct: number | null;
  exposurePct: number | null;
  dailyPnl: number | null;
  dailyPnlPct: number | null;
  quoteMode?: string;
  quoteWarnings: string[];
  noTradeReasons: string[];
  holdings: Array<{
    symbol: string;
    name: string;
    quantity: number | null;
    avgCost: number | null;
    currentPrice: number | null;
    marketValue: number | null;
    todayPnl: number | null;
    todayPnlPct: number | null;
    unrealizedPnl: number | null;
    unrealizedPnlPct: number | null;
    weightPct: number | null;
  }>;
  trades: Array<{
    side: string;
    symbol: string;
    name: string;
    quantity: number | null;
    price: number | null;
    amount: number | null;
    reason: string;
  }>;
}

export interface DailyJobSummary {
  date: string;
  scanCompleted: boolean;
  scanBatches: number;
  analyzedCount: number;
  strictEligibleCount?: number | null;
  nearMissCount?: number | null;
  paperRan: boolean;
  tradeCount: number;
  exposurePct: number | null;
  startedAt: string;
  finishedAt: string;
  notificationSent: boolean;
  notificationError?: string;
  paper?: DailyPaperReport;
}

export interface DailyJobDeps {
  now: Date;
  batchSize: number;
  maxBatches: number;
  loadScan: () => Promise<ScanResponseLike>;
  resetScan: () => Promise<ScanResponseLike>;
  scanStep: (batchSize: number) => Promise<ScanResponseLike>;
  runPaper: () => Promise<PaperRunLike>;
  notify: (summary: DailyJobSummary) => Promise<boolean>;
  writeLog: (summary: DailyJobSummary, detail: unknown) => Promise<void>;
}

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

function shanghaiDateString(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}

function isScanComplete(response: ScanResponseLike): boolean {
  return response.scanState?.status === "complete";
}

function isSameDayCompleteScan(response: ScanResponseLike, date: string): boolean {
  return isScanComplete(response) && response.scanState?.date === date;
}

function analyzedCount(response: ScanResponseLike): number {
  return Number(response.scanState?.analyzedCount ?? response.scanState?.cursor ?? 0) || 0;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function sumHoldingTodayPnl(summary: PaperSummaryLike | undefined): number | null {
  if (!summary || !Array.isArray(summary.holdings)) return null;
  const holdings = summary.holdings;
  if (holdings.length === 0) return 0;
  const values = holdings.map((holding) => numberOrNull(holding.todayPnl));
  if (values.some((value) => value === null)) return null;
  return round(values.reduce<number>((sum, value) => sum + (value ?? 0), 0));
}

function uniqueTexts(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function candidateSkipReasonTexts(response: PaperRunLike, strictEligibleCount: number | null): string[] {
  const skipped = (response.run?.candidateDecisions ?? []).filter(
    (decision) => decision.action === "skip" && Boolean(decision.reason?.trim())
  );
  const strictSkipped = skipped.filter((decision) => decision.grade === "A");
  const relevant = strictEligibleCount !== null && strictEligibleCount > 0 && strictSkipped.length > 0 ? strictSkipped : skipped;
  const counts = new Map<string, number>();
  for (const decision of relevant) {
    const reason = decision.reason?.trim();
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .map(([reason, count]) => `候选未执行：${reason}（${count}只）`);
}

function conflictsWithStrictCandidate(reason: string): boolean {
  return reason.includes("没有符合硬性交易规则") || reason.includes("未出现满足开仓条件");
}

function paperSkipReason(response: PaperRunLike): string | undefined {
  if (!response.run?.skipped) return undefined;
  if (response.run.skipReason === "paper trading already reviewed for this date") {
    return "本交易日已完成模拟复盘，未重复执行交易";
  }
  return response.run.skipReason?.trim() || "本轮模拟交易已跳过";
}

function formatNumber(value: number | null): string {
  if (value === null) return "未知";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatSignedNumber(value: number | null): string {
  if (value === null) return "未知";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatPct(value: number | null): string {
  if (value === null) return "未知";
  return `${formatNumber(value)}%`;
}

function formatSignedPct(value: number | null): string {
  if (value === null) return "未知";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}%`;
}

function buildPaperReport(response: PaperRunLike | null, strictEligibleCount: number | null): DailyPaperReport | undefined {
  const summary = response?.summary;
  if (!summary) return undefined;
  const totalAssets = numberOrNull(summary.totalAssets);
  const dailyPnl = sumHoldingTodayPnl(response?.run?.beforeSummary ?? summary);
  const startOfDayAssets = dailyPnl !== null && totalAssets !== null ? totalAssets - dailyPnl : null;
  const dailyPnlPct =
    dailyPnl !== null && startOfDayAssets !== null && startOfDayAssets > 0
      ? round((dailyPnl / startOfDayAssets) * 100)
      : null;
  const trades = response?.run?.trades ?? [];
  const holdingCount = response?.run?.beforeSummary?.holdings?.length ?? summary.holdings?.length ?? 0;
  const decisionQuoteStatus = response?.run?.beforeQuoteStatus ?? response?.quoteStatus;
  const quoteReliable = decisionQuoteStatus?.mode === "live" && (decisionQuoteStatus.warnings?.length ?? 0) === 0;
  const exitReason =
    holdingCount > 0
      ? quoteReliable
        ? "按本轮有效行情，当前持仓未触发系统退出条件"
        : "持仓行情不完整，退出条件未完整校验"
      : undefined;
  const skipReason = response ? paperSkipReason(response) : undefined;
  const candidateReasons = response ? candidateSkipReasonTexts(response, strictEligibleCount) : [];
  const reviewReasons = (response?.run?.review?.decisions ?? []).filter(
    (reason) => strictEligibleCount === null || strictEligibleCount <= 0 || !conflictsWithStrictCandidate(reason)
  );
  const missingCandidateReason =
    strictEligibleCount !== null && strictEligibleCount > 0 && candidateReasons.length === 0
      ? `严格可买 ${strictEligibleCount} 只，但候选跳过原因缺失`
      : undefined;
  const noTradeReasons =
    trades.length > 0
      ? []
      : skipReason
        ? [skipReason]
      : uniqueTexts([
          exitReason,
          ...candidateReasons,
          missingCandidateReason,
          ...reviewReasons
        ]).slice(0, 4);

  return {
    totalAssets,
    cash: numberOrNull(summary.cash),
    marketValue: numberOrNull(summary.marketValue),
    totalReturn: numberOrNull(summary.totalReturn),
    totalReturnPct: numberOrNull(summary.totalReturnPct),
    exposurePct: numberOrNull(summary.exposurePct),
    dailyPnl,
    dailyPnlPct,
    quoteMode: response?.quoteStatus?.mode,
    quoteWarnings: response?.quoteStatus?.warnings ?? [],
    noTradeReasons,
    holdings: (summary.holdings ?? []).slice(0, 5).map((holding) => ({
      symbol: holding.symbol ?? "",
      name: holding.name ?? "",
      quantity: numberOrNull(holding.quantity),
      avgCost: numberOrNull(holding.avgCost),
      currentPrice: numberOrNull(holding.currentPrice),
      marketValue: numberOrNull(holding.marketValue),
      todayPnl: numberOrNull(holding.todayPnl),
      todayPnlPct: numberOrNull(holding.todayPnlPct),
      unrealizedPnl: numberOrNull(holding.unrealizedPnl),
      unrealizedPnlPct: numberOrNull(holding.unrealizedPnlPct),
      weightPct: numberOrNull(holding.weightPct)
    })),
    trades: trades.slice(0, 5).map((trade) => ({
      side: trade.side ?? "",
      symbol: trade.symbol ?? "",
      name: trade.name ?? "",
      quantity: numberOrNull(trade.quantity),
      price: numberOrNull(trade.price),
      amount: numberOrNull(trade.amount),
      reason: trade.reason ?? ""
    }))
  };
}

function compactDetail(step: string, response: ScanResponseLike | PaperRunLike) {
  if ("scanState" in response) {
    return {
      step,
      scanState: {
        status: response.scanState?.status ?? "unknown",
        date: response.scanState?.date ?? "unknown",
        analyzedCount: response.scanState?.analyzedCount ?? 0,
        cursor: response.scanState?.cursor ?? 0,
        strictEligibleCount: response.scanState?.attribution?.strictEligibleCount ?? null,
        nearMissCount: response.scanState?.attribution?.nearMissCount ?? null
      }
    };
  }

  return {
    step,
    paper: {
      tradeCount: response.run?.trades?.length ?? 0,
      exposurePct: response.summary?.exposurePct ?? null,
      totalAssets: response.summary?.totalAssets ?? null,
      dailyPnl: sumHoldingTodayPnl(response.run?.beforeSummary ?? response.summary)
    }
  };
}

export function buildDailyJobMarkdown(summary: DailyJobSummary): string {
  const status = summary.scanCompleted && summary.paperRan ? "成功" : "未完成";
  const exposure = summary.exposurePct === null ? "未知" : `${summary.exposurePct}%`;
  const lines = [
    "# 明远交易系统日报",
    `> 日期：${summary.date}`,
    `> 状态：${status}`,
    `> 扫描：${summary.analyzedCount} 只 / ${summary.scanBatches} 批`,
    `> 模拟盘：${summary.paperRan ? "已执行" : "未执行"}`,
    `> 今日交易：${summary.tradeCount} 笔`,
    `> 当前仓位：${exposure}`,
    `> 完成时间：${summary.finishedAt}`
  ];
  if (summary.strictEligibleCount !== undefined && summary.strictEligibleCount !== null) {
    lines.splice(
      4,
      0,
      `> 买点：严格可买 ${summary.strictEligibleCount} 只 / 接近可买 ${summary.nearMissCount ?? "未知"} 只`
    );
  }

  if (summary.paper) {
    const paper = summary.paper;
    lines.push(
      "",
      "## 账户概览",
      `> 总资产：${formatNumber(paper.totalAssets)}`,
      `> 现金：${formatNumber(paper.cash)} / 持仓市值：${formatNumber(paper.marketValue)}`,
      `> 今日盈亏：${formatSignedNumber(paper.dailyPnl)} / ${formatSignedPct(paper.dailyPnlPct)}`,
      `> 累计盈亏：${formatSignedNumber(paper.totalReturn)} / ${formatSignedPct(paper.totalReturnPct)}`,
      `> 模拟盘仓位：${formatPct(paper.exposurePct)}`
    );

    if (paper.quoteWarnings.length > 0) {
      lines.push(`> 估值提示：${paper.quoteWarnings.slice(0, 2).join("；")}`);
    } else if (paper.quoteMode) {
      lines.push(`> 估值模式：${paper.quoteMode}`);
    }

    lines.push("", "## 当前持仓");
    if (paper.holdings.length === 0) {
      lines.push("> 暂无持仓");
    } else {
      for (const [index, holding] of paper.holdings.entries()) {
        lines.push(
          `> ${index + 1}. ${holding.symbol} ${holding.name}：${formatNumber(holding.quantity)}股 / 成本 ${formatNumber(
            holding.avgCost
          )} / 现价 ${formatNumber(holding.currentPrice)} / 市值 ${formatNumber(holding.marketValue)} / 浮盈亏 ${formatSignedNumber(
            holding.unrealizedPnl
          )} / ${formatSignedPct(holding.unrealizedPnlPct)} / 今日 ${formatSignedNumber(holding.todayPnl)} / ${formatSignedPct(
            holding.todayPnlPct
          )} / 仓位 ${formatPct(holding.weightPct)}`
        );
      }
    }

    lines.push("", "## 今日交易");
    if (paper.trades.length === 0) {
      lines.push("> 今日无新增交易");
      for (const reason of paper.noTradeReasons) {
        lines.push(`> 原因：${reason}`);
      }
    } else {
      for (const [index, trade] of paper.trades.entries()) {
        const side = trade.side === "sell" ? "卖出" : "买入";
        lines.push(
          `> ${index + 1}. ${side} ${trade.symbol} ${trade.name}：${formatNumber(trade.quantity)}股 / 价格 ${formatNumber(
            trade.price
          )} / 金额 ${formatNumber(trade.amount)} / ${trade.reason}`
        );
      }
    }
  }

  return lines.join("\n");
}

export async function sendWeComMarkdown(webhookUrl: string, content: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: { content }
    })
  });
  const text = await response.text();
  let payload: { errcode?: number; errmsg?: string } = {};
  try {
    payload = text ? (JSON.parse(text) as { errcode?: number; errmsg?: string }) : {};
  } catch {
    payload = {};
  }

  if (!response.ok || payload.errcode !== 0) {
    throw new Error(`Enterprise WeChat webhook failed: ${response.status} ${text}`);
  }
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
      `strictEligibleCount: ${summary.strictEligibleCount ?? "unknown"}`,
      `nearMissCount: ${summary.nearMissCount ?? "unknown"}`,
      `paperRan: ${summary.paperRan}`,
      `tradeCount: ${summary.tradeCount}`,
      `exposurePct: ${summary.exposurePct ?? "unknown"}`,
      `totalAssets: ${summary.paper?.totalAssets ?? "unknown"}`,
      `dailyPnl: ${summary.paper?.dailyPnl ?? "unknown"}`,
      `notificationSent: ${summary.notificationSent}`,
      `notificationError: ${summary.notificationError ?? "none"}`,
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
    loadScan: input?.loadScan ?? (() => readPaperBackgroundScan() as Promise<ScanResponseLike>),
    resetScan: input?.resetScan ?? (() => resetPaperBackgroundScan() as Promise<ScanResponseLike>),
    scanStep:
      input?.scanStep ??
      ((batchSize: number) =>
        runPaperBackgroundScanStep(new URL(`http://127.0.0.1/api/paper-trading/background-scan/step?batch=${batchSize}`)) as Promise<ScanResponseLike>),
    runPaper: input?.runPaper ?? (() => runPaperTradingCycle({ force: true, oncePerDay: true }) as Promise<PaperRunLike>),
    notify:
      input?.notify ??
      (async (summary) => {
        const webhookUrl = process.env.WEWORK_WEBHOOK_URL ?? process.env.WECOM_WEBHOOK_URL ?? "";
        if (!webhookUrl.trim()) return false;
        await sendWeComMarkdown(webhookUrl, buildDailyJobMarkdown(summary));
        return true;
      }),
    writeLog: input?.writeLog ?? writeDailyJobLog
  };
}

export async function runDailyJob(input?: Partial<DailyJobDeps>): Promise<DailyJobSummary> {
  const deps = defaultDeps(input);
  const startedAt = deps.now.toISOString();
  const date = shanghaiDateString(deps.now);
  const details: unknown[] = [];
  let scanResponse = await deps.loadScan();
  details.push(compactDetail("loadScan", scanResponse));
  let scanBatches = 0;

  if (!isSameDayCompleteScan(scanResponse, date)) {
    scanResponse = await deps.resetScan();
    details.push(compactDetail("resetScan", scanResponse));

    while (!isScanComplete(scanResponse) && scanBatches < deps.maxBatches) {
      scanResponse = await deps.scanStep(deps.batchSize);
      details.push(compactDetail("scanStep", scanResponse));
      scanBatches += 1;
    }
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
    strictEligibleCount: numberOrNull(scanResponse.scanState?.attribution?.strictEligibleCount),
    nearMissCount: numberOrNull(scanResponse.scanState?.attribution?.nearMissCount),
    paperRan: paperResponse !== null,
    tradeCount: paperResponse?.run?.trades?.length ?? 0,
    exposurePct: paperResponse?.summary?.exposurePct ?? null,
    startedAt,
    finishedAt: new Date().toISOString(),
    notificationSent: false,
    paper: buildPaperReport(
      paperResponse,
      numberOrNull(scanResponse.scanState?.attribution?.strictEligibleCount)
    )
  };
  try {
    summary.notificationSent = await deps.notify(summary);
  } catch (error) {
    summary.notificationSent = false;
    summary.notificationError = error instanceof Error ? error.message : String(error);
  }
  await deps.writeLog(summary, details);
  return summary;
}

function isMainModule(): boolean {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) {
  runWithOperationLock("daily-job", () => runDailyJob())
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    });
}
