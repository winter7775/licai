import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchStockHistory } from "./eastmoneyProvider";
import { loadRoughBacktestBenchmark, loadRoughBacktestSpot } from "./roughMonteCarloJob";
import { selectMarketCapUniverse, type DailyBar, type SpotStock } from "../src/live/marketScreener";
import {
  runStrictMonthlyBacktestLazy,
  runStrictMonteCarloFromClosedTrades,
  type MonthlyUniverseSnapshot,
  type StrictBacktestResult,
  type StrictMonteCarloResult
} from "../src/backtest/strictMonthlyBacktest";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SERVER_DIR, "..");
const CACHE_DIR = path.resolve(APP_DIR, "data/backtest-cache");
const OUTPUT_DIR = path.resolve(APP_DIR, "output/backtests");
const FULL_MODE = process.argv.includes("--full");
const HISTORY_LIMIT = Number(process.env.STRICT_BACKTEST_HISTORY_LIMIT ?? 2600);
const SOURCE_LIMIT = Number(process.env.STRICT_BACKTEST_SOURCE_LIMIT ?? (FULL_MODE ? 0 : 1600));
const MONTHLY_POOL_SIZE = Number(process.env.STRICT_BACKTEST_MONTHLY_POOL_SIZE ?? 800);
const MARKET_CAP_TOP_PCT = Number(process.env.STRICT_BACKTEST_MARKET_CAP_TOP_PCT ?? (FULL_MODE ? 1 : 0.3));
const MONTE_CARLO_ITERATIONS = Number(process.env.STRICT_BACKTEST_MONTE_CARLO_ITERATIONS ?? 5000);
const HISTORY_WORKERS = Number(process.env.STRICT_BACKTEST_HISTORY_WORKERS ?? (FULL_MODE ? 1 : 3));
const HISTORY_REQUEST_DELAY_MS = Number(process.env.STRICT_BACKTEST_REQUEST_DELAY_MS ?? (FULL_MODE ? 250 : 0));
const STRICT_BACKTEST_CONFIG = {
  initialCapital: 200_000,
  monthlyPoolSize: MONTHLY_POOL_SIZE,
  monthlyPoolLookbackDays: 60,
  maxExposurePct: 35,
  healthyTrendExposurePct: 70,
  strongTrendExposurePct: 90,
  maxSinglePositionPct: 12,
  maxTrialSinglePositionPct: 3,
  maxTrialTotalPositionPct: 10,
  riskPerTradePct: 1,
  trialRiskPerTradePct: 0.3,
  maxPortfolioRiskPct: 6,
  volatilityTargetPct: 18,
  minVolatilityExposureFactor: 0.55,
  drawdownSoftPct: 8,
  drawdownSoftExposurePct: 50,
  drawdownHardPct: 12,
  drawdownHardExposurePct: 25,
  drawdownCrisisPct: 18,
  allowedGrades: ["A"],
  slippagePct: 0.1,
  commissionPct: 0.025,
  transferFeePct: 0.001,
  stampDutyPct: 0.05,
  blockLimitOpenBuys: true,
  blockLimitDownStops: true
};

function shanghaiTimestamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString("en-US");
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${value.toFixed(2)}%`;
}

async function readHistoryCache(symbol: string, limit: number): Promise<DailyBar[] | null> {
  try {
    return JSON.parse(await readFile(path.join(CACHE_DIR, `${symbol}-${limit}.json`), "utf8")) as DailyBar[];
  } catch {
    return null;
  }
}

async function writeHistoryCache(symbol: string, limit: number, bars: DailyBar[]): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `${symbol}-${limit}.json`), JSON.stringify(bars), "utf8");
}

async function historyWithCache(symbol: string, limit: number): Promise<DailyBar[]> {
  const cached = await readHistoryCache(symbol, limit);
  if (cached && cached.length > 0) return cached;
  const bars = await fetchStockHistory(symbol, limit);
  await writeHistoryCache(symbol, limit, bars);
  return bars;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  workers: number,
  fn: (item: T, index: number) => Promise<R>,
  delayMs = 0
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, workers) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await sleep(delayMs);
        results[index] = await fn(items[index], index);
      }
    })
  );
  return results;
}

export function selectStrictSourceUniverse(
  stocks: SpotStock[],
  options: { marketCapTopPct: number; sourceLimit: number }
): SpotStock[] {
  const ranked = selectMarketCapUniverse(stocks, options.marketCapTopPct);
  const limit = Math.floor(Number(options.sourceLimit) || 0);
  return limit > 0 ? ranked.slice(0, limit) : ranked;
}

export interface HistoryMonthlyIndex {
  stock: SpotStock;
  entries: Array<{ activeMonth: string; asOfDate: string; metric: number }>;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function trailingAmount(history: DailyBar[], endIndex: number, lookbackDays: number): number {
  const start = Math.max(0, endIndex - Math.max(1, lookbackDays) + 1);
  return mean(history.slice(start, endIndex + 1).map((bar) => bar.amount));
}

export function buildHistoryMonthlyIndex(stock: SpotStock, history: DailyBar[], lookbackDays: number): HistoryMonthlyIndex {
  const entries: HistoryMonthlyIndex["entries"] = [];
  let previousMonth = "";
  for (let index = 0; index < history.length; index += 1) {
    const currentMonth = monthKey(history[index].date);
    if (previousMonth && currentMonth !== previousMonth && index > 0) {
      entries.push({
        activeMonth: currentMonth,
        asOfDate: history[index - 1].date,
        metric: trailingAmount(history, index - 1, lookbackDays)
      });
    }
    previousMonth = currentMonth;
  }
  return { stock, entries };
}

export function buildMonthlySnapshotsFromHistoryIndexes(indexes: HistoryMonthlyIndex[], poolSize: number): MonthlyUniverseSnapshot[] {
  const byMonth = new Map<string, Array<{ symbol: string; asOfDate: string; metric: number }>>();
  for (const index of indexes) {
    for (const entry of index.entries) {
      const rows = byMonth.get(entry.activeMonth) ?? [];
      rows.push({ symbol: index.stock.symbol, asOfDate: entry.asOfDate, metric: entry.metric });
      byMonth.set(entry.activeMonth, rows);
    }
  }
  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([activeMonth, rows]) => {
      const ranked = rows
        .filter((row) => row.metric > 0)
        .sort((left, right) => right.metric - left.metric || left.symbol.localeCompare(right.symbol))
        .slice(0, Math.max(1, poolSize));
      return {
        activeMonth,
        asOfDate: ranked.map((row) => row.asOfDate).sort().at(-1) ?? "",
        symbols: ranked.map((row) => row.symbol),
        rankMetric: "trailing_amount" as const
      };
    })
    .filter((snapshot) => snapshot.symbols.length > 0);
}

export function buildStrictMonthlyBacktestMarkdown(input: {
  generatedAt: string;
  sourceUniverseCount: number;
  usableUniverseCount: number;
  historyFailedCount?: number;
  historyYears: number;
  auditPath: string;
  backtest: StrictBacktestResult;
  monteCarlo: StrictMonteCarloResult;
  variants?: Array<{ label: string; backtest: StrictBacktestResult }>;
}): string {
  const backtest = input.backtest;
  const monteCarlo = input.monteCarlo;
  const variantLines =
    input.variants && input.variants.length > 0
      ? [
          "",
          "## A/B signal comparison",
          "",
          "| Mode | Final assets | Total return | Max drawdown | Trades | Win rate | Profit factor |",
          "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
          ...input.variants.map(({ label, backtest: item }) =>
            [
              `| ${label}`,
              formatNumber(item.finalAssets),
              formatPct(item.totalReturnPct),
              formatPct(item.maxDrawdownPct),
              String(item.tradeCount),
              formatPct(item.winRatePct),
              item.profitFactor === null ? "no loss samples" : item.profitFactor.toFixed(2)
            ].join(" | ") + " |"
          )
        ]
      : [];
  return [
    "# Strict monthly top-pool backtest + Monte Carlo",
    "",
    `Generated at: ${input.generatedAt}`,
    "Strategy version: V4 risk system (A-only execution, B-grade audit only, trend/volatility/drawdown exposure controls)",
    `Source universe: ${input.sourceUniverseCount}`,
    `Usable history universe: ${input.usableUniverseCount}`,
    `History failures/skips: ${formatNumber(input.historyFailedCount ?? Math.max(0, input.sourceUniverseCount - input.usableUniverseCount))}`,
    `History length: about ${input.historyYears} years`,
    `Audit file: ${input.auditPath}`,
    "",
    "## Replay result",
    "",
    `- Period: ${backtest.startedAt} to ${backtest.endedAt}`,
    `- Initial capital: ${formatNumber(backtest.initialCapital)}`,
    `- Final assets: ${formatNumber(backtest.finalAssets)}`,
    `- Total return: ${formatPct(backtest.totalReturnPct)}`,
    `- CAGR: ${formatPct(backtest.cagrPct)}`,
    `- Max drawdown: ${formatPct(backtest.maxDrawdownPct)}`,
    `- Closed trades: ${backtest.tradeCount}`,
    `- Win rate: ${formatPct(backtest.winRatePct)}`,
    `- Profit factor: ${backtest.profitFactor === null ? "no loss samples" : backtest.profitFactor.toFixed(2)}`,
    `- Average win: ${formatPct(backtest.averageWinPct)}`,
    `- Average loss: ${formatPct(backtest.averageLossPct)}`,
    `- Expectancy per trade: ${formatPct(backtest.expectancyPct)}`,
    "",
    "## Audit summary",
    "",
    `- Monthly snapshots: ${backtest.monthlySnapshots.length}`,
    `- Audit records: ${formatNumber(backtest.auditSummary.records)}`,
    `- Strict buy signals: ${formatNumber(backtest.auditSummary.buySignals)}`,
    `- B trial signals: ${formatNumber(backtest.auditSummary.trialSignals)}`,
    `- Watch records: ${formatNumber(backtest.auditSummary.watch)}`,
    `- Rejected records: ${formatNumber(backtest.auditSummary.rejected)}`,
    `- Error records: ${formatNumber(backtest.auditSummary.errors)}`,
    "",
    "## Monte Carlo result",
    "",
    `- Iterations: ${monteCarlo.iterations}`,
    `- Sampling mode: ${monteCarlo.samplingMode}`,
    `- Trade samples per run: ${monteCarlo.tradeSamplesPerRun}`,
    `- Ruin threshold: ${formatNumber(monteCarlo.ruinThreshold)}`,
    `- Profitable scenarios: ${formatPct(monteCarlo.profitableScenarioPct)}`,
    `- Busted scenarios: ${formatPct(monteCarlo.bustedScenarioPct)}`,
    `- Final assets P5: ${formatNumber(monteCarlo.finalAssets.p5)}`,
    `- Final assets P25: ${formatNumber(monteCarlo.finalAssets.p25)}`,
    `- Final assets P50: ${formatNumber(monteCarlo.finalAssets.p50)}`,
    `- Final assets P75: ${formatNumber(monteCarlo.finalAssets.p75)}`,
    `- Final assets P95: ${formatNumber(monteCarlo.finalAssets.p95)}`,
    `- Max drawdown P50: ${formatPct(monteCarlo.maxDrawdownPct.p50)}`,
    `- Max drawdown P95: ${formatPct(monteCarlo.maxDrawdownPct.p95)}`,
    `- Longest losing streak P50: ${formatNumber(monteCarlo.longestLosingStreak.p50)}`,
    `- Longest losing streak P95: ${formatNumber(monteCarlo.longestLosingStreak.p95)}`,
    `- Equity path percentile points: ${monteCarlo.pathPercentiles.length}`,
    `- Retained sample paths: ${monteCarlo.samplePaths.length}`,
    `- Loss probability: ${formatPct(monteCarlo.lossProbabilityPct)}`,
    `- Severe drawdown probability: ${formatPct(monteCarlo.severeDrawdownProbabilityPct)}`,
    ...variantLines,
    "",
    "## Warnings and limits",
    "",
    ...backtest.warnings.map((warning) => `- ${warning}`)
  ].join("\n");
}

export interface StrictGradeVariantSpec {
  label: string;
  allowedGrades: Array<"A" | "B">;
}

export async function runStrictGradeVariants(input: {
  variants: StrictGradeVariantSpec[];
  runVariant: (variant: StrictGradeVariantSpec) => Promise<StrictBacktestResult>;
}): Promise<Array<{ label: string; backtest: StrictBacktestResult }>> {
  const results: Array<{ label: string; backtest: StrictBacktestResult }> = [];
  for (const variant of input.variants) {
    const backtest = await input.runVariant(variant);
    results.push({ label: variant.label, backtest });
  }
  return results;
}

export async function runStrictMonthlyBacktestJob(): Promise<{
  jsonPath: string;
  markdownPath: string;
  auditPath: string;
  backtest: StrictBacktestResult;
  monteCarlo: StrictMonteCarloResult;
  variants: Array<{ label: string; backtest: StrictBacktestResult }>;
}> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const stamp = shanghaiTimestamp();
  const auditPath = path.join(OUTPUT_DIR, `strict-monthly-${stamp}.audit.jsonl`);
  const auditStream = createWriteStream(auditPath, { encoding: "utf8" });
  const spot = await loadRoughBacktestSpot();
  const marketCapUniverse = selectStrictSourceUniverse(spot.stocks, {
    marketCapTopPct: MARKET_CAP_TOP_PCT,
    sourceLimit: SOURCE_LIMIT
  });
  const historyIndexes = await mapWithConcurrency(marketCapUniverse, HISTORY_WORKERS, async (stock, index) => {
    process.stdout.write(`strict index ${index + 1}/${marketCapUniverse.length} ${stock.symbol}\n`);
    try {
      const history = await historyWithCache(stock.symbol, HISTORY_LIMIT);
      return history.length >= 260 ? buildHistoryMonthlyIndex(stock, history, 60) : null;
    } catch (error) {
      process.stdout.write(`strict skip ${stock.symbol}: ${error instanceof Error ? error.message : String(error)}\n`);
      return null;
    }
  }, HISTORY_REQUEST_DELAY_MS);
  const usableIndexes = historyIndexes.filter((item): item is HistoryMonthlyIndex => item !== null);
  const monthlySnapshots = buildMonthlySnapshotsFromHistoryIndexes(usableIndexes, MONTHLY_POOL_SIZE);
  const requiredSymbols = new Set(monthlySnapshots.flatMap((snapshot) => snapshot.symbols));
  const sourceBySymbol = new Map(marketCapUniverse.map((stock) => [stock.symbol, stock]));
  const requiredStocks = [...requiredSymbols].map((symbol) => sourceBySymbol.get(symbol)).filter((stock): stock is SpotStock => Boolean(stock));
  const historyFailedCount = marketCapUniverse.length - usableIndexes.length;
  const fallbackBars = requiredStocks[0] ? await historyWithCache(requiredStocks[0].symbol, HISTORY_LIMIT) : undefined;
  const benchmark = await loadRoughBacktestBenchmark({
    limit: HISTORY_LIMIT,
    fallbackBars
  });
  const rawBacktest = await runStrictMonthlyBacktestLazy({
    stocks: requiredStocks,
    benchmarkBars: benchmark.bars,
    monthlySnapshots,
    loadHistory: (symbol) => historyWithCache(symbol, HISTORY_LIMIT),
    config: STRICT_BACKTEST_CONFIG,
    onMonthStart: (info) => {
      process.stdout.write(`strict replay month ${info.activeMonth} ${info.date} load ${info.loadedSymbolCount}\n`);
    },
    onAuditRecord: (record) => {
      auditStream.write(`${JSON.stringify(record)}\n`);
    }
  });
  auditStream.end();
  await finished(auditStream);
  const backtest = {
    ...rawBacktest,
    warnings: [
      ...rawBacktest.warnings,
      ...benchmark.warnings,
      ...spot.warnings.map((warning) => `Spot universe warning: ${warning}`),
      `Spot universe provider mode: ${spot.mode}`,
      SOURCE_LIMIT > 0
        ? `Source universe is capped at ${SOURCE_LIMIT} current top-market-cap stocks before historical monthly replay.`
        : "Source universe uses the full current A-share spot universe before historical monthly replay.",
      `Lazy replay streams ${requiredStocks.length} monthly-pool symbols after indexing ${usableIndexes.length} usable source histories.`
    ]
  };
  const variants = await runStrictGradeVariants({
    variants: [
      { label: "A-only", allowedGrades: ["A"] as const },
      { label: "B-only", allowedGrades: ["B"] as const }
    ],
    runVariant: async (variant) => {
      const result = await runStrictMonthlyBacktestLazy({
        stocks: requiredStocks,
        benchmarkBars: benchmark.bars,
        monthlySnapshots,
        loadHistory: (symbol) => historyWithCache(symbol, HISTORY_LIMIT),
        config: {
          ...STRICT_BACKTEST_CONFIG,
          allowedGrades: [...variant.allowedGrades]
        },
        onMonthStart: (info) => {
          process.stdout.write(`strict replay ${variant.label} month ${info.activeMonth} ${info.date} load ${info.loadedSymbolCount}\n`);
        }
      });
      return { ...result, warnings: backtest.warnings };
    }
  });
  const monteCarlo = runStrictMonteCarloFromClosedTrades(backtest.closedTrades, {
    initialCapital: 200_000,
    iterations: MONTE_CARLO_ITERATIONS,
    seed: 20260702,
    samplingMode: "shuffle_without_replacement",
    retainedPathCount: 200,
    pathPointCount: 80
  });
  const payload = {
    generatedAt,
    input: {
      historyLimit: HISTORY_LIMIT,
      sourceLimit: SOURCE_LIMIT,
      monthlyPoolSize: MONTHLY_POOL_SIZE,
      marketCapTopPct: MARKET_CAP_TOP_PCT,
      sourceUniverseCount: marketCapUniverse.length,
      usableUniverseCount: usableIndexes.length,
      replayUniverseCount: requiredStocks.length,
      monthlySnapshotCount: monthlySnapshots.length,
      requiredReplaySymbols: requiredStocks.length,
      historyFailedCount,
      fullMode: FULL_MODE,
      historyWorkers: HISTORY_WORKERS,
      historyRequestDelayMs: HISTORY_REQUEST_DELAY_MS,
      auditPath
    },
    backtest,
    monteCarlo,
    variants
  };
  const jsonPath = path.join(OUTPUT_DIR, `strict-monthly-${stamp}.json`);
  const markdownPath = path.join(OUTPUT_DIR, `strict-monthly-${stamp}.md`);
  await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(
    markdownPath,
    buildStrictMonthlyBacktestMarkdown({
      generatedAt,
      sourceUniverseCount: marketCapUniverse.length,
      usableUniverseCount: usableIndexes.length,
      historyYears: Math.round(HISTORY_LIMIT / 250),
      historyFailedCount,
      auditPath,
      backtest,
      monteCarlo,
      variants
    }),
    "utf8"
  );
  return { jsonPath, markdownPath, auditPath, backtest, monteCarlo, variants };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runStrictMonthlyBacktestJob()
    .then((result) => {
      process.stdout.write(
        JSON.stringify(
          {
            jsonPath: result.jsonPath,
            markdownPath: result.markdownPath,
            auditPath: result.auditPath,
            fullMode: FULL_MODE,
            finalAssets: result.backtest.finalAssets,
            totalReturnPct: result.backtest.totalReturnPct,
            tradeCount: result.backtest.tradeCount,
            auditRecords: result.backtest.auditSummary.records,
            monteCarloP50: result.monteCarlo.finalAssets.p50
          },
          null,
          2
        )
      );
      process.stdout.write("\n");
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
