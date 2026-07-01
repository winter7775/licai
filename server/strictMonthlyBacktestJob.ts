import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchStockHistory } from "./eastmoneyProvider";
import { loadRoughBacktestBenchmark, loadRoughBacktestSpot } from "./roughMonteCarloJob";
import { selectMarketCapUniverse, type DailyBar } from "../src/live/marketScreener";
import {
  runStrictMonthlyBacktest,
  runStrictMonteCarloFromClosedTrades,
  type StrictBacktestResult,
  type StrictMonteCarloResult,
  type StrictUniverseItem
} from "../src/backtest/strictMonthlyBacktest";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SERVER_DIR, "..");
const CACHE_DIR = path.resolve(APP_DIR, "data/backtest-cache");
const OUTPUT_DIR = path.resolve(APP_DIR, "output/backtests");
const HISTORY_LIMIT = Number(process.env.STRICT_BACKTEST_HISTORY_LIMIT ?? 2600);
const SOURCE_LIMIT = Number(process.env.STRICT_BACKTEST_SOURCE_LIMIT ?? 1600);
const MONTHLY_POOL_SIZE = Number(process.env.STRICT_BACKTEST_MONTHLY_POOL_SIZE ?? 800);
const MARKET_CAP_TOP_PCT = Number(process.env.STRICT_BACKTEST_MARKET_CAP_TOP_PCT ?? 0.3);
const MONTE_CARLO_ITERATIONS = Number(process.env.STRICT_BACKTEST_MONTE_CARLO_ITERATIONS ?? 5000);

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

async function mapWithConcurrency<T, R>(items: T[], workers: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, workers) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index], index);
      }
    })
  );
  return results;
}

export function buildStrictMonthlyBacktestMarkdown(input: {
  generatedAt: string;
  sourceUniverseCount: number;
  usableUniverseCount: number;
  historyYears: number;
  auditPath: string;
  backtest: StrictBacktestResult;
  monteCarlo: StrictMonteCarloResult;
}): string {
  const backtest = input.backtest;
  const monteCarlo = input.monteCarlo;
  return [
    "# Strict monthly top-pool backtest + Monte Carlo",
    "",
    `Generated at: ${input.generatedAt}`,
    `Source universe: ${input.sourceUniverseCount}`,
    `Usable history universe: ${input.usableUniverseCount}`,
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
    `- Trade samples per run: ${monteCarlo.tradeSamplesPerRun}`,
    `- Final assets P5: ${formatNumber(monteCarlo.finalAssets.p5)}`,
    `- Final assets P25: ${formatNumber(monteCarlo.finalAssets.p25)}`,
    `- Final assets P50: ${formatNumber(monteCarlo.finalAssets.p50)}`,
    `- Final assets P75: ${formatNumber(monteCarlo.finalAssets.p75)}`,
    `- Final assets P95: ${formatNumber(monteCarlo.finalAssets.p95)}`,
    `- Max drawdown P50: ${formatPct(monteCarlo.maxDrawdownPct.p50)}`,
    `- Max drawdown P95: ${formatPct(monteCarlo.maxDrawdownPct.p95)}`,
    `- Loss probability: ${formatPct(monteCarlo.lossProbabilityPct)}`,
    `- Severe drawdown probability: ${formatPct(monteCarlo.severeDrawdownProbabilityPct)}`,
    "",
    "## Warnings and limits",
    "",
    ...backtest.warnings.map((warning) => `- ${warning}`)
  ].join("\n");
}

export async function runStrictMonthlyBacktestJob(): Promise<{
  jsonPath: string;
  markdownPath: string;
  auditPath: string;
  backtest: StrictBacktestResult;
  monteCarlo: StrictMonteCarloResult;
}> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const stamp = shanghaiTimestamp();
  const auditPath = path.join(OUTPUT_DIR, `strict-monthly-${stamp}.audit.jsonl`);
  const auditStream = createWriteStream(auditPath, { encoding: "utf8" });
  const spot = await loadRoughBacktestSpot();
  const marketCapUniverse = selectMarketCapUniverse(spot.stocks, MARKET_CAP_TOP_PCT).slice(0, SOURCE_LIMIT);
  const histories = await mapWithConcurrency(marketCapUniverse, 3, async (stock, index) => {
    process.stdout.write(`strict history ${index + 1}/${marketCapUniverse.length} ${stock.symbol}\n`);
    try {
      const history = await historyWithCache(stock.symbol, HISTORY_LIMIT);
      return history.length >= 260 ? ({ stock, history } satisfies StrictUniverseItem) : null;
    } catch (error) {
      process.stdout.write(`strict skip ${stock.symbol}: ${error instanceof Error ? error.message : String(error)}\n`);
      return null;
    }
  });
  const universe = histories.filter((item): item is StrictUniverseItem => item !== null);
  const benchmark = await loadRoughBacktestBenchmark({
    limit: HISTORY_LIMIT,
    fallbackBars: universe[0]?.history
  });
  const rawBacktest = runStrictMonthlyBacktest({
    universe,
    benchmarkBars: benchmark.bars,
    config: {
      initialCapital: 200_000,
      monthlyPoolSize: MONTHLY_POOL_SIZE,
      monthlyPoolLookbackDays: 60,
      maxExposurePct: 35,
      maxSinglePositionPct: 10,
      maxTrialSinglePositionPct: 3,
      maxTrialTotalPositionPct: 10
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
      `Source universe is capped at ${SOURCE_LIMIT} current top-market-cap stocks before historical monthly replay.`
    ]
  };
  const monteCarlo = runStrictMonteCarloFromClosedTrades(backtest.closedTrades, {
    initialCapital: 200_000,
    iterations: MONTE_CARLO_ITERATIONS,
    seed: 20260702
  });
  const payload = {
    generatedAt,
    input: {
      historyLimit: HISTORY_LIMIT,
      sourceLimit: SOURCE_LIMIT,
      monthlyPoolSize: MONTHLY_POOL_SIZE,
      marketCapTopPct: MARKET_CAP_TOP_PCT,
      sourceUniverseCount: marketCapUniverse.length,
      usableUniverseCount: universe.length,
      auditPath
    },
    backtest,
    monteCarlo
  };
  const jsonPath = path.join(OUTPUT_DIR, `strict-monthly-${stamp}.json`);
  const markdownPath = path.join(OUTPUT_DIR, `strict-monthly-${stamp}.md`);
  await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(
    markdownPath,
    buildStrictMonthlyBacktestMarkdown({
      generatedAt,
      sourceUniverseCount: marketCapUniverse.length,
      usableUniverseCount: universe.length,
      historyYears: Math.round(HISTORY_LIMIT / 250),
      auditPath,
      backtest,
      monteCarlo
    }),
    "utf8"
  );
  return { jsonPath, markdownPath, auditPath, backtest, monteCarlo };
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
