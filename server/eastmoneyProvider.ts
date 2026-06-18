import {
  analysisScore,
  analyzeHistory,
  parseEastmoneyKline,
  parseEastmoneySpotRow,
  parseSinaSpotRow,
  parseTencentQfqRows,
  prefilterSpotStocks,
  selectMarketCapUniverse,
  type DailyBar,
  type HistoryAnalysis,
  type SpotStock
} from "../src/live/marketScreener";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const EASTMONEY_SPOT_URL = "https://push2.eastmoney.com/api/qt/clist/get";
const EASTMONEY_HISTORY_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const SINA_SPOT_COUNT_URL = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount";
const SINA_SPOT_PAGE_URL = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";
const SINA_SPOT_PAGE_WORKERS = 3;
const EASTMONEY_SPOT_PAGE_SIZE = 100;
const EASTMONEY_SPOT_PAGE_WORKERS = 4;
const TENCENT_HISTORY_URL = "https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get";
const CACHE_TTL_MS = 3 * 60 * 1000;
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_EXE = path.resolve(SERVER_DIR, "../../../.codex_tmp/whisper-venv/Scripts/python.exe");
const PYTHON_BRIDGE = path.resolve(SERVER_DIR, "eastmoney_bridge.py");
const SCAN_CACHE_FILE = path.resolve(SERVER_DIR, "../data/live-scan-cache.json");
const DEFAULT_MARKET_CAP_TOP_PCT = 0.3;
const DEFAULT_INITIAL_POOL_LIMIT = 400;

export interface LiveScreenedStock {
  spot: SpotStock;
  history: DailyBar[];
  analysis: HistoryAnalysis;
  score: number;
}

export interface LiveScanResponse {
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
  candidates: LiveScreenedStock[];
  warnings: string[];
}

interface BridgeResult {
  ok: boolean;
  data?: any;
  error?: string;
}

export type SpotProviderMode = "live" | "sina" | "seed";
type HistoryProviderMode = "eastmoney" | "tencent";

let scanCache: { expiresAt: number; value: LiveScanResponse; key: string } | null = null;

const FALLBACK_SPOT_SEEDS: SpotStock[] = [
  seedStock("600879", "航天电子", "军工电子", 42, 8_000_000_000, 65_000_000_000),
  seedStock("600036", "招商银行", "银行", 7, 7_500_000_000, 850_000_000_000),
  seedStock("600941", "中国移动", "通信服务", 18, 3_500_000_000, 2_000_000_000_000),
  seedStock("600900", "长江电力", "电力", 22, 2_800_000_000, 700_000_000_000),
  seedStock("601318", "中国平安", "保险", 9, 6_000_000_000, 760_000_000_000),
  seedStock("300750", "宁德时代", "电池", 25, 9_000_000_000, 900_000_000_000),
  seedStock("000858", "五粮液", "白酒", 18, 4_000_000_000, 520_000_000_000),
  seedStock("601899", "紫金矿业", "工业金属", 20, 7_000_000_000, 500_000_000_000),
  seedStock("000333", "美的集团", "家电", 14, 3_000_000_000, 480_000_000_000),
  seedStock("601012", "隆基绿能", "光伏设备", 30, 4_500_000_000, 150_000_000_000),
  seedStock("688777", "中控技术", "自动化设备", 55, 900_000_000, 45_000_000_000),
  seedStock("518880", "黄金ETF华安", "黄金ETF", 0, 1_200_000_000, 30_000_000_000)
];

function seedStock(
  symbol: string,
  name: string,
  industry: string,
  peTtm: number,
  amount: number,
  floatMarketCap: number
): SpotStock {
  return {
    symbol,
    name,
    industry,
    price: 10,
    changePct: 0,
    changeAmount: 0,
    volume: Math.round(amount / 10),
    amount,
    turnoverRate: 1,
    peTtm,
    volumeRatio: 1,
    high: 10,
    low: 10,
    open: 10,
    previousClose: 10,
    totalMarketCap: floatMarketCap,
    floatMarketCap
  };
}

function hasUsableScan(value: LiveScanResponse): boolean {
  return value.analyzedCount > 0 && value.tradeDate.length > 0;
}

function scanCacheKey(options?: {
  prefilterLimit?: number;
  historyLimit?: number;
  historyOffset?: number;
  displayLimit?: number;
  marketCapTopPct?: number;
}): string {
  return `${options?.marketCapTopPct ?? DEFAULT_MARKET_CAP_TOP_PCT}:${options?.prefilterLimit ?? DEFAULT_INITIAL_POOL_LIMIT}:${options?.historyLimit ?? "all"}:${options?.historyOffset ?? 0}:${options?.displayLimit ?? 10}`;
}

function secId(symbol: string): string {
  return `${/^[569]/.test(symbol) ? 1 : 0}.${symbol}`;
}

function tencentSymbol(symbol: string): string {
  return `${/^[569]/.test(symbol) ? "sh" : "sz"}${symbol}`;
}

export function collectBatchPayloads(results: BridgeResult[]): {
  payloads: any[];
  failedCount: number;
  errors: string[];
} {
  const payloads: any[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.ok && result.data) {
      payloads.push(result.data);
    } else {
      errors.push(result.error ?? "Eastmoney request failed");
    }
  }

  return {
    payloads,
    failedCount: errors.length,
    errors
  };
}

export function eastmoneySpotPageNumbers(total: number, pageSize = EASTMONEY_SPOT_PAGE_SIZE): number[] {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const safePageSize = Math.max(1, Math.floor(Number(pageSize) || EASTMONEY_SPOT_PAGE_SIZE));
  return Array.from({ length: Math.ceil(safeTotal / safePageSize) }, (_, index) => index + 1);
}

export function collectEastmoneySpotPayloads(results: BridgeResult[]): {
  stocks: SpotStock[];
  failedCount: number;
  errors: string[];
} {
  const stocksBySymbol = new Map<string, SpotStock>();
  const errors: string[] = [];

  for (const result of results) {
    const rows = result.ok && Array.isArray(result.data?.data?.diff) ? result.data.data.diff : null;
    if (!rows) {
      errors.push(result.error ?? "Eastmoney spot page request failed");
      continue;
    }
    for (const row of rows) {
      const stock = parseEastmoneySpotRow(row);
      if (stock.symbol) stocksBySymbol.set(stock.symbol, stock);
    }
  }

  return {
    stocks: [...stocksBySymbol.values()],
    failedCount: errors.length,
    errors
  };
}

export function isCompleteSpotUniverse(total: number, stockCount: number): boolean {
  if (total <= 0 || stockCount <= 0) return false;
  if (stockCount >= total) return true;
  return stockCount >= 1_000 && stockCount / total >= 0.8;
}

export function collectSinaSpotPayloads(results: BridgeResult[]): { stocks: SpotStock[]; failedCount: number; errors: string[] } {
  const stocks: SpotStock[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (!result.ok || !Array.isArray(result.data)) {
      errors.push(result.error ?? "Sina spot page request failed");
      continue;
    }
    stocks.push(...result.data.map((row: Record<string, unknown>) => parseSinaSpotRow(row)));
  }

  return {
    stocks,
    failedCount: errors.length,
    errors
  };
}

export function latestHistoryTradeDate(analyzed: Array<Pick<LiveScreenedStock, "history">>): string {
  const dates = analyzed
    .map((item) => item.history[item.history.length - 1]?.date ?? "")
    .filter(Boolean)
    .sort();
  return dates[dates.length - 1] ?? "";
}

export function alignSpotWithLatestHistory(stock: SpotStock, history: DailyBar[]): SpotStock {
  const latest = history[history.length - 1];
  if (!latest) return stock;

  return {
    ...stock,
    price: latest.close,
    changePct: latest.changePct,
    changeAmount: latest.changeAmount,
    volume: latest.volume > 0 ? latest.volume : stock.volume,
    amount: latest.amount > 0 ? latest.amount : stock.amount,
    turnoverRate: latest.turnoverRate > 0 ? latest.turnoverRate : stock.turnoverRate,
    high: latest.high,
    low: latest.low,
    open: latest.open,
    previousClose: Number.isFinite(latest.close - latest.changeAmount) ? latest.close - latest.changeAmount : stock.previousClose
  };
}

export async function fetchSpotForScreen(
  provider: () => Promise<{ total: number; stocks: SpotStock[] }> = fetchAshareSpot,
  fallbackProvider: () => Promise<{ total: number; stocks: SpotStock[] }> = fetchSinaAshareSpot
): Promise<{
  spot: { total: number; stocks: SpotStock[] };
  warnings: string[];
  mode: SpotProviderMode;
}> {
  let primaryError: unknown = null;
  try {
    const spot = await provider();
    if (isCompleteSpotUniverse(spot.total, spot.stocks.length)) {
      return { spot, warnings: [], mode: "live" };
    }
    throw new Error(`Eastmoney spot coverage incomplete: ${spot.stocks.length}/${spot.total}`);
  } catch (error) {
    primaryError = error;
  }

  try {
    const spot = await fallbackProvider();
    if (isCompleteSpotUniverse(spot.total, spot.stocks.length)) {
      return {
        spot,
        warnings: [
          `东方财富全市场快照失败，已切换新浪财经公开行情接口：${primaryError instanceof Error ? primaryError.message : String(primaryError)}`
        ],
        mode: "sina"
      };
    }
    throw new Error(`Sina spot coverage incomplete: ${spot.stocks.length}/${spot.total}`);
  } catch (fallbackError) {
    return {
      spot: {
        total: FALLBACK_SPOT_SEEDS.length,
        stocks: FALLBACK_SPOT_SEEDS
      },
      warnings: [
        `全市场快照刷新失败，使用本地种子池继续拉取真实日线：东方财富 ${primaryError instanceof Error ? primaryError.message : String(primaryError)}；新浪 ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
      ],
      mode: "seed"
    };
  }
}

async function readDiskScanCache(): Promise<LiveScanResponse | null> {
  try {
    const value = JSON.parse(await readFile(SCAN_CACHE_FILE, "utf8")) as LiveScanResponse;
    return hasUsableScan(value) ? value : null;
  } catch {
    return null;
  }
}

export async function readLiveScreenDiskCache(): Promise<LiveScanResponse | null> {
  return readDiskScanCache();
}

async function writeDiskScanCache(value: LiveScanResponse): Promise<void> {
  try {
    await mkdir(path.dirname(SCAN_CACHE_FILE), { recursive: true });
    await writeFile(SCAN_CACHE_FILE, JSON.stringify(value, null, 2), "utf8");
  } catch {
    // Cache persistence must not break live screening.
  }
}

async function fetchJsonBatchRaw(urls: URL[], workers = 6): Promise<BridgeResult[]> {
  return await new Promise((resolve, reject) => {
    const child = spawn(PYTHON_EXE, [PYTHON_BRIDGE], {
      cwd: SERVER_DIR,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let output = "";
    let errorOutput = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Python data bridge timed out"));
    }, 180_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(errorOutput || `Python data bridge exited with code ${code}`));
        return;
      }
      try {
        const payload = JSON.parse(output) as { results: BridgeResult[] };
        resolve(payload.results);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ urls: urls.map((url) => url.toString()), workers }));
  });
}

async function fetchJson(url: URL): Promise<any> {
  const batch = collectBatchPayloads(await fetchJsonBatchRaw([url], 1));
  if (batch.payloads.length === 0) {
    throw new Error(batch.errors[0] ?? "Eastmoney request failed");
  }
  return batch.payloads[0];
}

export async function fetchAshareSpot(): Promise<{ total: number; stocks: SpotStock[] }> {
  const firstPage = await fetchJson(eastmoneySpotPageUrl(1, EASTMONEY_SPOT_PAGE_SIZE));
  const firstRows = Array.isArray(firstPage.data?.diff) ? firstPage.data.diff : [];
  const total = Number(firstPage.data?.total ?? firstRows.length);
  const remainingUrls = eastmoneySpotPageNumbers(total, EASTMONEY_SPOT_PAGE_SIZE)
    .slice(1)
    .map((page) => eastmoneySpotPageUrl(page, EASTMONEY_SPOT_PAGE_SIZE));
  const remainingPages = remainingUrls.length > 0 ? await fetchJsonBatchRaw(remainingUrls, EASTMONEY_SPOT_PAGE_WORKERS) : [];
  const pages = collectEastmoneySpotPayloads([{ ok: true, data: firstPage }, ...remainingPages]);

  if (!isCompleteSpotUniverse(total, pages.stocks.length)) {
    throw new Error(`Eastmoney spot coverage incomplete after pagination: ${pages.stocks.length}/${total}`);
  }

  return {
    total,
    stocks: pages.stocks
  };
}

function eastmoneySpotPageUrl(page: number, pageSize: number): URL {
  const url = new URL(EASTMONEY_SPOT_URL);
  url.search = new URLSearchParams({
    pn: String(page),
    pz: String(pageSize),
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    fid: "f6",
    fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
    fields: "f12,f14,f2,f3,f4,f5,f6,f8,f9,f10,f15,f16,f17,f18,f20,f21,f100"
  }).toString();
  return url;
}

function sinaSpotCountUrl(): URL {
  const url = new URL(SINA_SPOT_COUNT_URL);
  url.search = new URLSearchParams({ node: "hs_a" }).toString();
  return url;
}

function sinaSpotPageUrl(page: number, pageSize: number): URL {
  const url = new URL(SINA_SPOT_PAGE_URL);
  url.search = new URLSearchParams({
    page: String(page),
    num: String(pageSize),
    sort: "amount",
    asc: "0",
    node: "hs_a",
    symbol: "",
    _s_r_a: "init"
  }).toString();
  return url;
}

export function sinaSpotPageWorkers(): number {
  return SINA_SPOT_PAGE_WORKERS;
}

export async function fetchSinaAshareSpot(): Promise<{ total: number; stocks: SpotStock[] }> {
  const pageSize = 100;
  const countPayload = await fetchJson(sinaSpotCountUrl());
  const total = Number(countPayload);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Sina spot count returned empty universe");
  }

  const pageCount = Math.ceil(total / pageSize);
  const pageUrls = Array.from({ length: pageCount }, (_, index) => sinaSpotPageUrl(index + 1, pageSize));
  const pages = collectSinaSpotPayloads(await fetchJsonBatchRaw(pageUrls, sinaSpotPageWorkers()));

  if (pages.stocks.length === 0) {
    throw new Error(pages.errors[0] ?? "Sina spot pages returned empty universe");
  }

  return {
    total,
    stocks: pages.stocks
  };
}

export async function fetchStockHistory(symbol: string, limit = 260): Promise<DailyBar[]> {
  try {
    const response = await fetchJson(historyUrl(symbol, limit));
    const lines = Array.isArray(response.data?.klines) ? response.data.klines : [];
    if (lines.length > 0) return lines.map((line: string) => parseEastmoneyKline(line));
  } catch {
    // Fall through to Tencent qfq daily bars.
  }
  const response = await fetchJson(tencentHistoryUrl(symbol, limit));
  return parseTencentHistoryResponse(response, symbol);
}

function historyUrl(symbol: string, limit = 260): URL {
  const url = new URL(EASTMONEY_HISTORY_URL);
  url.search = new URLSearchParams({
    secid: secId(symbol),
    klt: "101",
    fqt: "1",
    lmt: String(limit),
    end: "20500101",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
  }).toString();
  return url;
}

function tencentHistoryUrl(symbol: string, limit = 260): URL {
  const url = new URL(TENCENT_HISTORY_URL);
  url.search = new URLSearchParams({
    param: `${tencentSymbol(symbol)},day,,,${limit},qfq`
  }).toString();
  return url;
}

function parseTencentHistoryResponse(response: Record<string, any>, symbol: string): DailyBar[] {
  const key = tencentSymbol(symbol);
  const rows = response.data?.[key]?.qfqday ?? response.data?.[key]?.day ?? [];
  return Array.isArray(rows) ? parseTencentQfqRows(rows) : [];
}

type HistoryBatch = {
  rows: Array<{ stock: SpotStock; history: DailyBar[] }>;
  failedCount: number;
  errors: string[];
};

export function historyProviderForSpotMode(mode: SpotProviderMode): HistoryProviderMode {
  return mode === "live" ? "eastmoney" : "tencent";
}

async function fetchTencentHistories(stocks: SpotStock[]): Promise<HistoryBatch> {
  const responses = await fetchJsonBatchRaw(stocks.map((stock) => tencentHistoryUrl(stock.symbol)), 3);
  const rows: Array<{ stock: SpotStock; history: DailyBar[] }> = [];
  const errors: string[] = [];

  responses.forEach((response, index) => {
    const stock = stocks[index];
    if (!response.ok || !response.data) {
      errors.push(`${stock.symbol} Tencent: ${response.error ?? "history request failed"}`);
      return;
    }
    const history = parseTencentHistoryResponse(response.data, stock.symbol);
    if (history.length === 0) {
      errors.push(`${stock.symbol} Tencent: empty history`);
      return;
    }
    rows.push({ stock, history });
  });

  return {
    rows,
    failedCount: stocks.length - rows.length,
    errors
  };
}

async function fetchHistories(stocks: SpotStock[], provider: HistoryProviderMode = "eastmoney"): Promise<HistoryBatch> {
  if (provider === "tencent") {
    return fetchTencentHistories(stocks);
  }

  const responses = await fetchJsonBatchRaw(stocks.map((stock) => historyUrl(stock.symbol)), 3);
  const rows: Array<{ stock: SpotStock; history: DailyBar[] }> = [];
  const errors: string[] = [];
  const fallbackStocks: SpotStock[] = [];

  responses.forEach((response, index) => {
    if (!response.ok || !response.data) {
      fallbackStocks.push(stocks[index]);
      errors.push(`${stocks[index]?.symbol ?? "unknown"} Eastmoney: ${response.error ?? "history request failed"}`);
      return;
    }
    const lines = Array.isArray(response.data?.klines) ? response.data.klines : [];
    if (lines.length === 0) {
      fallbackStocks.push(stocks[index]);
      errors.push(`${stocks[index]?.symbol ?? "unknown"} Eastmoney: empty history`);
      return;
    }
    rows.push({
      stock: stocks[index],
      history: lines.map((line: string) => parseEastmoneyKline(line))
    });
  });

  if (fallbackStocks.length > 0) {
    const fallbackBatch = await fetchTencentHistories(fallbackStocks);
    rows.push(...fallbackBatch.rows);
    errors.push(...fallbackBatch.errors);
  }

  return {
    rows,
    failedCount: stocks.length - rows.length,
    errors
  };
}

export function pickTopRecommendations(analyzed: LiveScreenedStock[], displayLimit = 10): LiveScreenedStock[] {
  return analyzed
    .sort((left, right) => {
      const leftSignalRank = left.analysis.signalType === "watch" ? 0 : 1;
      const rightSignalRank = right.analysis.signalType === "watch" ? 0 : 1;
      return rightSignalRank - leftSignalRank || right.score - left.score;
    })
    .slice(0, displayLimit);
}

export function selectHistoryCandidates<T>(prefiltered: T[], historyLimit?: number, historyOffset = 0): T[] {
  const offset = Math.max(0, Math.floor(Number(historyOffset) || 0));
  return Number.isFinite(historyLimit) ? prefiltered.slice(offset, offset + Number(historyLimit)) : prefiltered.slice(offset);
}

export async function runLiveScreen(options?: {
  force?: boolean;
  prefilterLimit?: number;
  historyLimit?: number;
  historyOffset?: number;
  displayLimit?: number;
  marketCapTopPct?: number;
  cache?: boolean;
}): Promise<LiveScanResponse> {
  const force = options?.force ?? false;
  const cacheKey = scanCacheKey(options);
  const useCache = options?.cache !== false;
  if (useCache && !force && scanCache && scanCache.key === cacheKey && scanCache.expiresAt > Date.now() && hasUsableScan(scanCache.value)) {
    return scanCache.value;
  }

  const startedAt = Date.now();
  const spotResult = await fetchSpotForScreen(fetchAshareSpot);
  const spot = spotResult.spot;
  const spotWarnings = spotResult.warnings;

  if (spotResult.mode === "seed") {
    if (useCache && scanCache && hasUsableScan(scanCache.value)) {
      return {
        ...scanCache.value,
        asOf: new Date().toISOString(),
        warnings: [...spotWarnings, "已使用本轮服务内最近一次成功扫描。", ...scanCache.value.warnings]
      };
    }
    const diskCache = useCache ? await readDiskScanCache() : null;
    if (diskCache) {
      scanCache = { expiresAt: Date.now() + CACHE_TTL_MS, value: diskCache, key: cacheKey };
      return {
        ...diskCache,
        asOf: new Date().toISOString(),
        warnings: [...spotWarnings, "已使用磁盘中的最近一次成功扫描。", ...diskCache.warnings]
      };
    }
  }

  const marketCapTopPct = options?.marketCapTopPct ?? DEFAULT_MARKET_CAP_TOP_PCT;
  const marketCapUniverse = selectMarketCapUniverse(spot.stocks, marketCapTopPct);
  const initialPoolTarget = options?.prefilterLimit ?? DEFAULT_INITIAL_POOL_LIMIT;
  const prefiltered = prefilterSpotStocks(marketCapUniverse, initialPoolTarget);
  const historyCandidates = selectHistoryCandidates(prefiltered, options?.historyLimit, options?.historyOffset);
  const historyBatch = await fetchHistories(historyCandidates, historyProviderForSpotMode(spotResult.mode));
  const analyzed: LiveScreenedStock[] = [];
  let failedCount = historyBatch.failedCount;

  for (const result of historyBatch.rows) {
    try {
      const stock = alignSpotWithLatestHistory(result.stock, result.history);
      const analysis = analyzeHistory(stock, result.history);
      analyzed.push({
        spot: stock,
        history: result.history,
        analysis,
        score: analysisScore(analysis)
      });
    } catch {
      failedCount += 1;
    }
  }

  if (useCache && analyzed.length === 0 && scanCache && hasUsableScan(scanCache.value)) {
    return {
      ...scanCache.value,
      asOf: new Date().toISOString(),
      warnings: ["本次候选日线全部失败，已使用最近一次成功扫描。", ...historyBatch.errors, ...scanCache.value.warnings]
    };
  }

  const candidates = pickTopRecommendations(analyzed, options?.displayLimit ?? 10);
  const latestTradeDate = latestHistoryTradeDate(analyzed);
  const provider = spotResult.mode === "sina" ? "sina-public" : spotResult.mode === "seed" ? "seed-public" : "eastmoney-public";
  const sourceLabel =
    spotResult.mode === "sina"
      ? "新浪财经公开行情接口 + 东方财富/腾讯日线"
      : spotResult.mode === "seed"
        ? "本地种子池 + 东方财富/腾讯日线"
        : "东方财富公开行情接口";
  const result: LiveScanResponse = {
    provider,
    sourceLabel,
    asOf: new Date().toISOString(),
    tradeDate: latestTradeDate,
    universeCount: spot.total,
    marketCapUniverseCount: marketCapUniverse.length,
    marketCapTopPct: Math.round(marketCapTopPct * 100),
    initialPoolTarget,
    prefilteredCount: prefiltered.length,
    analyzedCount: analyzed.length,
    candidateCount: candidates.length,
    signalCount: analyzed.filter((item) => item.analysis.signalType !== "watch").length,
    watchCount: analyzed.filter((item) => item.analysis.signalType === "watch").length,
    durationMs: Date.now() - startedAt,
    candidates,
    warnings: [
      ...spotWarnings,
      "公开行情接口无正式稳定性承诺，页面保留本地演示数据作为降级方案。",
      "当前扫描未接入财报中的扣非净利润、营收增速、商誉等字段。",
      latestTradeDate ? `行情日期来自最近可取得的交易日：${latestTradeDate}。` : "未能识别最近交易日。",
      ...(failedCount > 0 ? [`${failedCount} 只股票历史日线请求失败，已跳过。`, ...historyBatch.errors.slice(0, 3)] : [])
    ]
  };
  if (useCache && hasUsableScan(result)) {
    scanCache = { expiresAt: Date.now() + CACHE_TTL_MS, value: result, key: cacheKey };
    await writeDiskScanCache(result);
  }
  return result;
}
