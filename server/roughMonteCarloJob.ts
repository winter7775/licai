import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBenchmarkHistory, fetchSpotForScreen, fetchStockHistory, type SpotProviderMode } from "./eastmoneyProvider";
import { prefilterSpotStocks, selectMarketCapUniverse, type DailyBar, type SpotStock } from "../src/live/marketScreener";
import {
  runMonteCarloFromClosedTrades,
  runRoughBacktest,
  type RoughBacktestResult,
  type RoughMonteCarloResult,
  type RoughUniverseItem
} from "../src/backtest/roughBacktest";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SERVER_DIR, "..");
const CACHE_DIR = path.resolve(APP_DIR, "data/backtest-cache");
const OUTPUT_DIR = path.resolve(APP_DIR, "output/backtests");
const HISTORY_LIMIT = Number(process.env.BACKTEST_HISTORY_LIMIT ?? 2600);
const POOL_TARGET = Number(process.env.BACKTEST_POOL_TARGET ?? 400);
const MARKET_CAP_TOP_PCT = Number(process.env.BACKTEST_MARKET_CAP_TOP_PCT ?? 0.3);
const MONTE_CARLO_ITERATIONS = Number(process.env.BACKTEST_MONTE_CARLO_ITERATIONS ?? 5000);

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
    const filePath = path.join(CACHE_DIR, `${symbol}-${limit}.json`);
    return JSON.parse(await readFile(filePath, "utf8")) as DailyBar[];
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

const BENCHMARK_CACHE_SYMBOL = "benchmark-000300";

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

export async function loadRoughBacktestSpot(
  provider = fetchSpotForScreen
): Promise<{ total: number; stocks: SpotStock[]; warnings: string[]; mode: SpotProviderMode }> {
  const result = await provider();
  return {
    total: result.spot.total,
    stocks: result.spot.stocks,
    warnings: result.warnings,
    mode: result.mode
  };
}

export async function loadRoughBacktestBenchmark(input: {
  limit: number;
  provider?: (limit: number) => Promise<DailyBar[]>;
  readCache?: (symbol: string, limit: number) => Promise<DailyBar[] | null>;
  writeCache?: (symbol: string, limit: number, bars: DailyBar[]) => Promise<void>;
  fallbackBars?: DailyBar[];
}): Promise<{ bars: DailyBar[]; warnings: string[] }> {
  const provider = input.provider ?? fetchBenchmarkHistory;
  const readCache = input.readCache ?? readHistoryCache;
  const writeCache = input.writeCache ?? writeHistoryCache;
  try {
    const bars = await provider(input.limit);
    if (bars.length > 0) {
      await writeCache(BENCHMARK_CACHE_SYMBOL, input.limit, bars);
      return { bars, warnings: [] };
    }
    throw new Error("benchmark provider returned empty history");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cached = await readCache(BENCHMARK_CACHE_SYMBOL, input.limit);
    if (cached && cached.length > 0) {
      return {
        bars: cached,
        warnings: [`Benchmark history live fetch failed: ${message}`, "Using cached CSI300 benchmark history."]
      };
    }
    if (input.fallbackBars && input.fallbackBars.length >= 260) {
      return {
        bars: input.fallbackBars,
        warnings: [
          `Benchmark history live fetch failed: ${message}`,
          "Using proxy benchmark from the first usable stock history; relative-strength and market-regime gates are rough only."
        ]
      };
    }
    throw error;
  }
}

export function buildRoughBacktestMarkdown(input: {
  generatedAt: string;
  universeCount: number;
  historyYears: number;
  backtest: RoughBacktestResult;
  monteCarlo: RoughMonteCarloResult;
}): string {
  const backtest = input.backtest;
  const monteCarlo = input.monteCarlo;
  return [
    "# 粗测版十年回测 + 蒙特卡洛",
    "",
    `生成时间：${input.generatedAt}`,
    `样本股票数：${input.universeCount}`,
    `历史长度：约 ${input.historyYears} 年`,
    "",
    "## 回测结果",
    "",
    `- 区间：${backtest.startedAt} 至 ${backtest.endedAt}`,
    `- 初始本金：${formatNumber(backtest.initialCapital)}`,
    `- 最终资产：${formatNumber(backtest.finalAssets)}`,
    `- 总收益：${formatPct(backtest.totalReturnPct)}`,
    `- 年化收益：${formatPct(backtest.cagrPct)}`,
    `- 最大回撤：${formatPct(backtest.maxDrawdownPct)}`,
    `- 闭合交易数：${backtest.tradeCount}`,
    `- 胜率：${formatPct(backtest.winRatePct)}`,
    `- 盈亏比：${backtest.profitFactor === null ? "无亏损样本" : backtest.profitFactor.toFixed(2)}`,
    `- 平均盈利：${formatPct(backtest.averageWinPct)}`,
    `- 平均亏损：${formatPct(backtest.averageLossPct)}`,
    `- 单笔期望：${formatPct(backtest.expectancyPct)}`,
    "",
    "## 蒙特卡洛结果",
    "",
    `- 模拟次数：${monteCarlo.iterations}`,
    `- 每轮重采样交易数：${monteCarlo.tradeSamplesPerRun}`,
    `- 最终资产 P5：${formatNumber(monteCarlo.finalAssets.p5)}`,
    `- 最终资产 P25：${formatNumber(monteCarlo.finalAssets.p25)}`,
    `- 最终资产 P50：${formatNumber(monteCarlo.finalAssets.p50)}`,
    `- 最终资产 P75：${formatNumber(monteCarlo.finalAssets.p75)}`,
    `- 最终资产 P95：${formatNumber(monteCarlo.finalAssets.p95)}`,
    `- 最大回撤 P50：${formatPct(monteCarlo.maxDrawdownPct.p50)}`,
    `- 最大回撤 P95：${formatPct(monteCarlo.maxDrawdownPct.p95)}`,
    `- 最终亏损概率：${formatPct(monteCarlo.lossProbabilityPct)}`,
    `- 超 30% 回撤概率：${formatPct(monteCarlo.severeDrawdownProbabilityPct)}`,
    "",
    "## 粗测限制",
    "",
    ...backtest.warnings.map((warning) => `- ${warning}`)
  ].join("\n");
}

export async function runRoughMonteCarloJob(): Promise<{
  jsonPath: string;
  markdownPath: string;
  backtest: RoughBacktestResult;
  monteCarlo: RoughMonteCarloResult;
}> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const spot = await loadRoughBacktestSpot();
  if (spot.warnings.length > 0) {
    process.stdout.write(`spot warnings: ${spot.warnings.join(" | ")}\n`);
  }
  const marketCapUniverse = selectMarketCapUniverse(spot.stocks, MARKET_CAP_TOP_PCT);
  const pool = prefilterSpotStocks(marketCapUniverse, POOL_TARGET, {
    coreLimit: POOL_TARGET,
    rotationSeed: "rough-backtest"
  });
  const histories = await mapWithConcurrency(pool, 3, async (stock, index) => {
    process.stdout.write(`history ${index + 1}/${pool.length} ${stock.symbol}\n`);
    try {
      const history = await historyWithCache(stock.symbol, HISTORY_LIMIT);
      return history.length >= 260 ? ({ stock, history } satisfies RoughUniverseItem) : null;
    } catch (error) {
      process.stdout.write(`skip ${stock.symbol}: ${error instanceof Error ? error.message : String(error)}\n`);
      return null;
    }
  });
  const universe = histories.filter((item): item is RoughUniverseItem => item !== null);
  const benchmark = await loadRoughBacktestBenchmark({
    limit: HISTORY_LIMIT,
    fallbackBars: universe[0]?.history
  });
  const rawBacktest = runRoughBacktest({
    universe,
    benchmarkBars: benchmark.bars,
    config: {
      initialCapital: 200_000,
      maxExposurePct: 35,
      maxSinglePositionPct: 10,
      maxTrialSinglePositionPct: 3,
      maxTrialTotalPositionPct: 10
    }
  });
  const backtest = {
    ...rawBacktest,
    warnings: [
      ...rawBacktest.warnings,
      ...benchmark.warnings,
      ...spot.warnings.map((warning) => `Spot universe warning: ${warning}`),
      `Spot universe provider mode: ${spot.mode}`
    ]
  };
  const monteCarlo = runMonteCarloFromClosedTrades(backtest.closedTrades, {
    initialCapital: 200_000,
    iterations: MONTE_CARLO_ITERATIONS,
    seed: 20260701
  });
  const stamp = shanghaiTimestamp();
  const payload = {
    generatedAt,
    input: {
      historyLimit: HISTORY_LIMIT,
      poolTarget: POOL_TARGET,
      marketCapTopPct: MARKET_CAP_TOP_PCT,
      universeCount: universe.length
    },
    backtest,
    monteCarlo
  };
  const jsonPath = path.join(OUTPUT_DIR, `rough-monte-carlo-${stamp}.json`);
  const markdownPath = path.join(OUTPUT_DIR, `rough-monte-carlo-${stamp}.md`);
  await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(
    markdownPath,
    buildRoughBacktestMarkdown({
      generatedAt,
      universeCount: universe.length,
      historyYears: Math.round(HISTORY_LIMIT / 250),
      backtest,
      monteCarlo
    }),
    "utf8"
  );
  return { jsonPath, markdownPath, backtest, monteCarlo };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRoughMonteCarloJob()
    .then((result) => {
      process.stdout.write(
        JSON.stringify(
          {
            jsonPath: result.jsonPath,
            markdownPath: result.markdownPath,
            finalAssets: result.backtest.finalAssets,
            totalReturnPct: result.backtest.totalReturnPct,
            tradeCount: result.backtest.tradeCount,
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
