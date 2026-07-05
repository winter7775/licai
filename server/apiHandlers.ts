import path from "node:path";
import {
  generatePaperTradingPlan,
  refreshPaperAccountRisk,
  summarizePaperAccount,
  type PaperAccount,
  type PaperAccountSummary,
  type PaperCandidate
} from "../src/domain/paperTrading";
import type { ProtectionPriceBar } from "../src/domain/profitProtection";
import type { PaperAttributionCandidate } from "../src/domain/paperAttribution";
import { calculatePortfolioSummary, upsertHolding, type HoldingQuote, type PortfolioHolding, type PortfolioState } from "../src/domain/portfolio";
import {
  fetchAshareSpot,
  fetchStockHistory,
  readLiveScreenDiskCache,
  runLiveScreen,
  type LiveScanResponse,
  type LiveScreenedStock
} from "./eastmoneyProvider";
import { getPositionStatusResponse } from "./positionStatusProvider";
import {
  createPaperScanState,
  markPaperScanError,
  mergePaperScanBatch,
  readPaperScanState,
  writePaperScanState,
  type PaperScanState
} from "./paperScanState";
import { readPaperTradingDb, writePaperTradingDb } from "./paperTradingStore";
import { readPortfolioDb, writePortfolioDb } from "./portfolioStore";

const PORTFOLIO_DB_PATH = path.resolve(process.cwd(), "data/portfolio.json");
const PAPER_TRADING_DB_PATH = path.resolve(process.cwd(), "data/paper-trading.json");
const PAPER_SCAN_STATE_PATH = path.resolve(process.cwd(), "data/paper-scan-state.json");
const SPOT_CACHE_TTL_MS = 60 * 1000;
const PAPER_TRADING_HISTORY_LIMIT = 20;
const PAPER_TRADING_DISPLAY_LIMIT = 20;
const PAPER_SCAN_BATCH_SIZE = 40;
const PAPER_SCAN_DAILY_LIMIT = 800;
const PAPER_MARKET_CAP_TOP_PCT = 30;
const PAPER_INITIAL_POOL_TARGET = 800;
const PAPER_QUOTE_TIMEOUT_MS = 5_000;
const PAPER_HISTORY_QUOTE_TIMEOUT_MS = 1_000;

let spotCache: Awaited<ReturnType<typeof fetchAshareSpot>> | null = null;
let spotCacheExpiresAt = 0;

interface PortfolioSearchResult {
  symbol: string;
  name: string;
  industry: string;
  price: number;
  changePct: number;
  source: string;
}

export function shouldQueryLiveForPortfolioSearch(localResults: PortfolioSearchResult[]): boolean {
  return localResults.length === 0;
}

export function buildLocalPortfolioSearchResults(portfolio: PortfolioState, query: string): PortfolioSearchResult[] {
  const text = query.trim();
  if (!text) return [];

  return portfolio.holdings
    .filter((holding) => holding.symbol.includes(text) || holding.name.includes(text))
    .slice(0, 10)
    .map((holding) => ({
      symbol: holding.symbol,
      name: holding.name,
      industry: "本地持仓",
      price: holding.costPrice,
      changePct: 0,
      source: "portfolio"
    }));
}

const DEFAULT_FULL_HISTORY_LIMIT = 20;

function boundedNumber(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, min), max);
}

function shanghaiDateString(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}

function paperScanFallback(): { date: string; batchSize: number; dailyLimit: number; marketCapTopPct: number; initialPoolTarget: number } {
  return {
    date: shanghaiDateString(),
    batchSize: PAPER_SCAN_BATCH_SIZE,
    dailyLimit: PAPER_SCAN_DAILY_LIMIT,
    marketCapTopPct: PAPER_MARKET_CAP_TOP_PCT,
    initialPoolTarget: PAPER_INITIAL_POOL_TARGET
  };
}

async function readCurrentPaperScanState(): Promise<PaperScanState> {
  return readPaperScanState(PAPER_SCAN_STATE_PATH, paperScanFallback());
}

export function parseLiveScreenRequestOptions(requestUrl: URL): {
  force: boolean;
  prefilterLimit?: number;
  historyLimit?: number;
  displayLimit: number;
} {
  const force = requestUrl.searchParams.get("refresh") === "1";
  const displayLimit = boundedNumber(requestUrl.searchParams.get("display"), 10, 1, 20);

  if (requestUrl.searchParams.get("scan") === "full") {
    return {
      force,
      prefilterLimit: undefined,
      historyLimit: boundedNumber(requestUrl.searchParams.get("history"), DEFAULT_FULL_HISTORY_LIMIT, 20, 300),
      displayLimit
    };
  }

  const legacyLimit = requestUrl.searchParams.get("limit");
  if (legacyLimit !== null) {
    const prefilterLimit = boundedNumber(legacyLimit, 28, 10, 500);
    return {
      force,
      prefilterLimit,
      historyLimit: prefilterLimit,
      displayLimit
    };
  }

  return {
    force,
    prefilterLimit: undefined,
    historyLimit: DEFAULT_FULL_HISTORY_LIMIT,
    displayLimit
  };
}

function sendJson(response: any, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readJsonBody<T>(request: any): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  return (text ? JSON.parse(text) : {}) as T;
}

async function getSpotCached(force = false): Promise<Awaited<ReturnType<typeof fetchAshareSpot>>> {
  if (!force && spotCache && spotCacheExpiresAt > Date.now()) return spotCache;
  spotCache = await fetchAshareSpot();
  spotCacheExpiresAt = Date.now() + SPOT_CACHE_TTL_MS;
  return spotCache;
}

function quoteMapFromSpot(stocks: Awaited<ReturnType<typeof fetchAshareSpot>>["stocks"], symbols: string[]): Record<string, HoldingQuote> {
  const wanted = new Set(symbols);
  return Object.fromEntries(
    stocks
      .filter((stock) => wanted.has(stock.symbol))
      .map((stock) => [
        stock.symbol,
        {
          price: stock.price,
          name: stock.name,
          industry: stock.industry
        }
      ])
  );
}

function paperQuotePricesFromSpot(stocks: Awaited<ReturnType<typeof fetchAshareSpot>>["stocks"], symbols: string[]): Record<string, number> {
  const wanted = new Set(symbols);
  return Object.fromEntries(stocks.filter((stock) => wanted.has(stock.symbol)).map((stock) => [stock.symbol, stock.price]));
}

function paperPreviousClosesFromSpot(stocks: Awaited<ReturnType<typeof fetchAshareSpot>>["stocks"], symbols: string[]): Record<string, number> {
  const wanted = new Set(symbols);
  return Object.fromEntries(
    stocks
      .filter((stock) => wanted.has(stock.symbol) && stock.previousClose > 0)
      .map((stock) => [stock.symbol, stock.previousClose])
  );
}

export function shouldFetchPaperQuotes(symbols: string[]): boolean {
  return symbols.length > 0;
}

export async function fillMissingPaperQuotePrices(
  symbols: string[],
  quotes: Record<string, number>,
  previousClosesOrHistoryProvider: Record<string, number> | typeof fetchStockHistory = {},
  historyProvider: typeof fetchStockHistory = fetchStockHistory,
  options: { perSymbolTimeoutMs?: number } = {}
): Promise<{ quotes: Record<string, number>; previousCloses: Record<string, number>; filledSymbols: string[]; missingSymbols: string[] }> {
  const nextQuotes = { ...quotes };
  const previousCloses = typeof previousClosesOrHistoryProvider === "function" ? {} : previousClosesOrHistoryProvider;
  const resolvedHistoryProvider = typeof previousClosesOrHistoryProvider === "function" ? previousClosesOrHistoryProvider : historyProvider;
  const nextPreviousCloses = { ...previousCloses };
  const filledSymbols: string[] = [];
  const missingSymbols: string[] = [];

  for (const symbol of Array.from(new Set(symbols))) {
    if (nextQuotes[symbol] && nextQuotes[symbol] > 0 && nextPreviousCloses[symbol] && nextPreviousCloses[symbol] > 0) continue;
    try {
      const history = await withTimeout(
        resolvedHistoryProvider(symbol, 20),
        options.perSymbolTimeoutMs ?? PAPER_HISTORY_QUOTE_TIMEOUT_MS,
        `holding history quote timed out for ${symbol}`
      );
      const latestClose = history[history.length - 1]?.close;
      const previousClose = history[history.length - 2]?.close;
      if (latestClose && latestClose > 0) {
        if (!nextQuotes[symbol] || nextQuotes[symbol] <= 0) {
          nextQuotes[symbol] = latestClose;
          filledSymbols.push(symbol);
        }
        if (previousClose && previousClose > 0) {
          nextPreviousCloses[symbol] = previousClose;
        }
      } else {
        if (!nextQuotes[symbol] || nextQuotes[symbol] <= 0) missingSymbols.push(symbol);
      }
    } catch {
      if (!nextQuotes[symbol] || nextQuotes[symbol] <= 0) missingSymbols.push(symbol);
    }
  }

  return { quotes: nextQuotes, previousCloses: nextPreviousCloses, filledSymbols, missingSymbols };
}

export function paperQuotesFromSummary(summary: Pick<PaperAccountSummary, "holdings">): Record<string, number> {
  return Object.fromEntries(
    summary.holdings
      .filter((holding) => holding.currentPrice > 0)
      .map((holding) => [holding.symbol.padStart(6, "0").slice(-6), holding.currentPrice])
  );
}

export async function fetchPaperHoldingBars(
  symbols: string[],
  historyProvider: typeof fetchStockHistory = fetchStockHistory
): Promise<Record<string, ProtectionPriceBar[]>> {
  const barsBySymbol: Record<string, ProtectionPriceBar[]> = {};
  for (const symbol of Array.from(new Set(symbols.map((item) => item.padStart(6, "0").slice(-6))))) {
    try {
      const history = await historyProvider(symbol, 40);
      const bars = history
        .filter((bar) => bar.high > 0 && bar.low > 0 && bar.close > 0)
        .map((bar) => ({ high: bar.high, low: bar.low, close: bar.close }));
      if (bars.length > 0) barsBySymbol[symbol] = bars;
    } catch {
      // Quote fallback can still run without ATR; keep a single-symbol failure from blocking the daily job.
    }
  }
  return barsBySymbol;
}

export function paperCandidateFromLiveStock(item: LiveScreenedStock): PaperCandidate {
  const hardRulesPassed = !item.analysis.rules.some((rule) => rule.severity === "hard" && !rule.passed);
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
    hardRulesPassed,
    rules: item.analysis.rules,
    reason: `${item.analysis.signalType}，规则通过 ${item.analysis.rules.filter((rule) => rule.passed).length}/${item.analysis.rules.length}`
  };
}

function paperCandidateFromAttributionCandidate(item: PaperAttributionCandidate): PaperCandidate {
  const hardRulesPassed = item.hardRulesPassed ?? !item.rules.some((rule) => (rule.severity ?? "soft") === "hard" && !rule.passed);
  return {
    symbol: item.symbol,
    name: item.name,
    industry: item.industry ?? "未分类",
    price: item.price,
    signalType: item.signalType,
    score: item.score,
    stopPrice: item.stopPrice ?? Number((item.price * 0.93).toFixed(2)),
    takeProfitPrice: item.takeProfitPrice ?? Number((item.price * 1.4).toFixed(2)),
    suggestedPositionPct: item.suggestedPositionPct ?? (item.signalType === "watch" ? 0 : 6),
    hardRulesPassed,
    rules: item.rules,
    reason: `${item.signalType}，后台扫描规则通过 ${item.rules.filter((rule) => rule.passed).length}/${item.rules.length}`
  };
}

export function buildPaperTradingScreenOptions(force = false) {
  return {
    force,
    prefilterLimit: undefined,
    historyLimit: PAPER_TRADING_HISTORY_LIMIT,
    displayLimit: PAPER_TRADING_DISPLAY_LIMIT
  };
}

export function markPaperTradingCachedScan(scan: LiveScanResponse): LiveScanResponse {
  return {
    ...scan,
    asOf: new Date().toISOString(),
    warnings: ["模拟盘使用最近一次成功扫描缓存，避免现网日线接口阻塞自动运行。", ...scan.warnings]
  };
}

async function runPaperTradingScreen(force = false): Promise<LiveScanResponse> {
  const cached = await readLiveScreenDiskCache();
  if (cached) return markPaperTradingCachedScan(cached);
  return runLiveScreen(buildPaperTradingScreenOptions(force));
}

async function buildPortfolioResponse(options?: { forceQuote?: boolean }) {
  const portfolio = await readPortfolioDb(PORTFOLIO_DB_PATH);
  const warnings: string[] = [];
  let quotes: Record<string, HoldingQuote> = {};

  try {
    const spot = await getSpotCached(options?.forceQuote);
    quotes = quoteMapFromSpot(
      spot.stocks,
      portfolio.holdings.map((holding) => holding.symbol)
    );
  } catch (error) {
    warnings.push(`持仓现价刷新失败，暂用成本价估算：${errorMessage(error)}`);
  }

  return {
    portfolio,
    summary: calculatePortfolioSummary(portfolio, quotes),
    quoteStatus: {
      mode: warnings.length > 0 ? "fallback" : "live",
      warnings,
      updatedAt: new Date().toISOString()
    }
  };
}

async function buildPaperTradingResponse(
  account: PaperAccount,
  options?: { forceQuote?: boolean; useHistoryFallback?: boolean; quoteTimeoutMs?: number }
) {
  const warnings: string[] = [];
  let quotes: Record<string, number> = {};
  let previousCloses: Record<string, number> = {};
  const scanState = await readCurrentPaperScanState();
  const holdingSymbols = account.holdings.map((holding) => holding.symbol);

  try {
    if (shouldFetchPaperQuotes(holdingSymbols)) {
      const spot = await withTimeout(
        getSpotCached(options?.forceQuote),
        options?.quoteTimeoutMs ?? PAPER_QUOTE_TIMEOUT_MS,
        "paper holding quote refresh timed out"
      );
      quotes = paperQuotePricesFromSpot(spot.stocks, holdingSymbols);
      previousCloses = paperPreviousClosesFromSpot(spot.stocks, holdingSymbols);
    }
  } catch (error) {
    warnings.push(`模拟盘现价刷新失败，暂用成本价估算：${errorMessage(error)}`);
  }

  if (shouldFetchPaperQuotes(holdingSymbols) && options?.useHistoryFallback !== false) {
    const filled = await fillMissingPaperQuotePrices(holdingSymbols, quotes, previousCloses);
    quotes = filled.quotes;
    previousCloses = filled.previousCloses;
    if (filled.filledSymbols.length > 0) {
      warnings.push(`部分持仓实时现价缺失，已使用最近日线收盘价估值：${filled.filledSymbols.join(", ")}`);
    }
    if (filled.missingSymbols.length > 0) {
      warnings.push(`部分持仓仍缺少行情，暂用成本价估算：${filled.missingSymbols.join(", ")}`);
    }
  } else if (shouldFetchPaperQuotes(holdingSymbols)) {
    const missingSymbols = holdingSymbols.filter((symbol) => !quotes[symbol] || quotes[symbol] <= 0);
    if (missingSymbols.length > 0) {
      warnings.push(`持仓行情快速刷新未取全，先返回本地模拟盘数据，缺失现价暂用成本价：${missingSymbols.join(", ")}`);
    }
  }

  const refreshedAt = new Date().toISOString();
  const refreshedAccount = refreshPaperAccountRisk(account, quotes, {}, refreshedAt);

  return {
    account: refreshedAccount,
    summary: summarizePaperAccount(refreshedAccount, quotes, previousCloses),
    quoteStatus: {
      mode: warnings.length > 0 ? "fallback" : "live",
      warnings,
      updatedAt: refreshedAt
    },
    scanState
  };
}

export function hasPaperReviewForDate(account: PaperAccount, date: string): boolean {
  return account.reviews.some((review) => review.date === date);
}

export function shouldSkipPaperTradingReview(account: PaperAccount, date: string, scanUpdatedAt?: string, oncePerDay = false): boolean {
  if (!oncePerDay) return false;
  const existingReview = account.reviews.find((review) => review.date === date);
  if (!existingReview) return false;
  if (!scanUpdatedAt) return true;

  const reviewTime = new Date(existingReview.createdAt).getTime();
  const scanTime = new Date(scanUpdatedAt).getTime();
  if (!Number.isFinite(reviewTime) || !Number.isFinite(scanTime)) return true;
  return reviewTime >= scanTime;
}

export async function runPaperTradingCycle(options?: { force?: boolean; oncePerDay?: boolean }) {
  const account = await readPaperTradingDb(PAPER_TRADING_DB_PATH);
  const beforeResponse = await buildPaperTradingResponse(account, { forceQuote: options?.force });
  const tradeDate = shanghaiDateString();
  const existingReview = account.reviews.find((review) => review.date === tradeDate);
  const scanState = await readCurrentPaperScanState();
  if (existingReview && shouldSkipPaperTradingReview(account, tradeDate, scanState.updatedAt, options?.oncePerDay)) {
    return {
      ...beforeResponse,
      run: {
        trades: [],
        review: existingReview,
        beforeSummary: beforeResponse.summary,
        skipped: true,
        skipReason: "paper trading already reviewed for this date"
      }
    };
  }

  const singleNameMaxPct =
    beforeResponse.summary.holdings.length > 0 ? Math.max(...beforeResponse.summary.holdings.map((holding) => holding.weightPct)) : 0;
  const position = await getPositionStatusResponse(
    {
      exposurePct: beforeResponse.summary.exposurePct,
      singleNameMaxPct
    },
    { refresh: options?.force }
  );
  const scan = scanState.candidates.length > 0 ? null : await runPaperTradingScreen(options?.force);
  const candidates =
    scanState.candidates.length > 0
      ? scanState.candidates.map((item) => paperCandidateFromAttributionCandidate(item))
      : (scan?.candidates ?? []).map((item) => paperCandidateFromLiveStock(item));
  const holdingSymbols = account.holdings.map((holding) => holding.symbol);
  const plan = generatePaperTradingPlan({
    account,
    candidates,
    quotes: paperQuotesFromSummary(beforeResponse.summary),
    holdingBars: await fetchPaperHoldingBars(holdingSymbols),
    position: position.status,
    tradedAt: new Date().toISOString()
  });
  const saved = await writePaperTradingDb(PAPER_TRADING_DB_PATH, plan.account);
  const response = await buildPaperTradingResponse(saved, { forceQuote: true });

  return {
    ...response,
    run: {
      trades: plan.trades,
      review: plan.review,
      candidateDecisions: plan.candidateDecisions,
      beforeSummary: beforeResponse.summary,
      scan: {
        provider: scan?.provider ?? "eastmoney-public",
        tradeDate: scan?.tradeDate ?? scanState.date,
        universeCount: scan?.universeCount ?? scanState.universeCount,
        prefilteredCount: scan?.prefilteredCount ?? scanState.prefilteredCount,
        analyzedCount: scan?.analyzedCount ?? scanState.analyzedCount,
        candidateCount: scan?.candidateCount ?? scanState.candidates.length,
        historyLimit: scan ? PAPER_TRADING_HISTORY_LIMIT : scanState.analyzedCount
      },
      position: {
        gate: position.status.finalGate,
        source: position.source
      }
    }
  };
}

async function buildPaperTradingResponseWithScanState(scanState: PaperScanState) {
  const account = await readPaperTradingDb(PAPER_TRADING_DB_PATH);
  const response = await buildPaperTradingResponse(account);
  return {
    ...response,
    scanState
  };
}

export async function readPaperBackgroundScan() {
  const state = await readCurrentPaperScanState();
  return buildPaperTradingResponseWithScanState(state);
}

export async function resetPaperBackgroundScan() {
  const state = createPaperScanState(paperScanFallback());
  const saved = await writePaperScanState(PAPER_SCAN_STATE_PATH, state);
  return buildPaperTradingResponseWithScanState(saved);
}

export async function runPaperBackgroundScanStep(requestUrl: URL) {
  const state = await readCurrentPaperScanState();
  if (state.status === "complete") {
    return buildPaperTradingResponseWithScanState(state);
  }

  const batchSize = boundedNumber(requestUrl.searchParams.get("batch"), state.batchSize, 1, 100);
  const scan = await runLiveScreen({
    force: true,
    prefilterLimit: state.scanPolicy.initialPoolTarget,
    historyLimit: batchSize,
    historyOffset: state.cursor,
    displayLimit: batchSize,
    marketCapTopPct: state.scanPolicy.marketCapTopPct / 100,
    cache: false
  });
  if (scan.provider === "seed-public") {
    const failed = markPaperScanError(state, "全市场行情源降级为本地种子池，本批未计入正式后台扫描。");
    const saved = await writePaperScanState(PAPER_SCAN_STATE_PATH, failed);
    return buildPaperTradingResponseWithScanState(saved);
  }
  const next = mergePaperScanBatch({ ...state, status: "running", batchSize }, scan, batchSize);
  const saved = await writePaperScanState(PAPER_SCAN_STATE_PATH, next);
  return buildPaperTradingResponseWithScanState(saved);
}

async function savePortfolio(portfolio: PortfolioState) {
  await writePortfolioDb(PORTFOLIO_DB_PATH, portfolio);
  return buildPortfolioResponse({ forceQuote: true });
}

async function handlePortfolioRequest(request: any, response: any, requestUrl: URL): Promise<boolean> {
  if (!requestUrl.pathname.startsWith("/api/portfolio")) return false;

  try {
    if (requestUrl.pathname === "/api/portfolio" && request.method === "GET") {
      sendJson(response, 200, await buildPortfolioResponse());
      return true;
    }

    if (requestUrl.pathname === "/api/portfolio" && request.method === "PUT") {
      const body = await readJsonBody<PortfolioState>(request);
      sendJson(response, 200, await savePortfolio(body));
      return true;
    }

    if (requestUrl.pathname === "/api/portfolio/holding" && request.method === "POST") {
      const current = await readPortfolioDb(PORTFOLIO_DB_PATH);
      const holding = await readJsonBody<PortfolioHolding>(request);
      const next = upsertHolding(current, {
        ...holding,
        updatedAt: holding.updatedAt || new Date().toISOString()
      });
      sendJson(response, 200, await savePortfolio(next));
      return true;
    }

    const deleteMatch = requestUrl.pathname.match(/^\/api\/portfolio\/holding\/(\d{6})$/);
    if (deleteMatch && request.method === "DELETE") {
      const current = await readPortfolioDb(PORTFOLIO_DB_PATH);
      const existing = current.holdings.find((holding) => holding.symbol === deleteMatch[1]);
      const next = upsertHolding(current, {
        symbol: deleteMatch[1],
        name: existing?.name ?? "",
        quantity: 0,
        costPrice: 0,
        note: "清仓",
        updatedAt: new Date().toISOString()
      });
      sendJson(response, 200, await savePortfolio(next));
      return true;
    }

    if (requestUrl.pathname === "/api/portfolio/search" && request.method === "GET") {
      const query = (requestUrl.searchParams.get("q") ?? "").trim();
      if (!query) {
        sendJson(response, 200, { results: [] });
        return true;
      }
      const localPortfolio = await readPortfolioDb(PORTFOLIO_DB_PATH);
      const localResults = buildLocalPortfolioSearchResults(localPortfolio, query);
      if (!shouldQueryLiveForPortfolioSearch(localResults)) {
        sendJson(response, 200, { results: localResults.slice(0, 10) });
        return true;
      }

      let liveResults: PortfolioSearchResult[] = [];
      try {
        const spot = await getSpotCached();
        liveResults = spot.stocks
          .filter((stock) => stock.symbol.includes(query) || stock.name.includes(query))
          .slice(0, 10)
          .map((stock) => ({
            symbol: stock.symbol,
            name: stock.name,
            industry: stock.industry,
            price: stock.price,
            changePct: stock.changePct,
            source: "live"
          }));
      } catch {
        liveResults = [];
      }
      sendJson(response, 200, { results: liveResults });
      return true;
    }

    sendJson(response, 404, { error: "Unknown portfolio route" });
    return true;
  } catch (error) {
    sendJson(response, 502, {
      error: "PORTFOLIO_PROVIDER_ERROR",
      message: errorMessage(error)
    });
    return true;
  }
}

async function handlePaperTradingRequest(request: any, response: any, requestUrl: URL): Promise<boolean> {
  if (!requestUrl.pathname.startsWith("/api/paper-trading")) return false;

  try {
    if (requestUrl.pathname === "/api/paper-trading" && request.method === "GET") {
      const account = await readPaperTradingDb(PAPER_TRADING_DB_PATH);
      sendJson(response, 200, await buildPaperTradingResponse(account, { useHistoryFallback: false }));
      return true;
    }

    if (requestUrl.pathname === "/api/paper-trading/run" && request.method === "POST") {
      sendJson(response, 200, await runPaperTradingCycle({ force: requestUrl.searchParams.get("refresh") === "1" }));
      return true;
    }

    if (requestUrl.pathname === "/api/paper-trading/background-scan/start" && request.method === "POST") {
      sendJson(response, 200, await resetPaperBackgroundScan());
      return true;
    }

    if (requestUrl.pathname === "/api/paper-trading/background-scan/step" && request.method === "POST") {
      sendJson(response, 200, await runPaperBackgroundScanStep(requestUrl));
      return true;
    }

    sendJson(response, 404, { error: "Unknown paper trading route" });
    return true;
  } catch (error) {
    sendJson(response, 502, {
      error: "PAPER_TRADING_ERROR",
      message: errorMessage(error)
    });
    return true;
  }
}

async function portfolioExposureForPositionStatus() {
  const portfolioResponse = await buildPortfolioResponse();
  return {
    portfolioResponse,
    exposure: {
      exposurePct: portfolioResponse.summary.exposurePct,
      singleNameMaxPct: portfolioResponse.summary.singleNameMaxPct
    }
  };
}

async function handleLiveRequest(request: any, response: any, requestUrl: URL): Promise<boolean> {
  if (!requestUrl.pathname.startsWith("/api/live/")) return false;

  try {
    if (requestUrl.pathname === "/api/live/health") {
      sendJson(response, 200, {
        provider: "eastmoney-public",
        sourceLabel: "东方财富公开行情接口",
        ready: true,
        checkedAt: new Date().toISOString()
      });
      return true;
    }

    if (requestUrl.pathname === "/api/live/spot") {
      const spot = await getSpotCached(requestUrl.searchParams.get("refresh") === "1");
      const limit = Math.min(Number(requestUrl.searchParams.get("limit") ?? 20), 100);
      sendJson(response, 200, { total: spot.total, stocks: spot.stocks.slice(0, limit) });
      return true;
    }

    if (requestUrl.pathname === "/api/live/screen") {
      sendJson(response, 200, await runLiveScreen(parseLiveScreenRequestOptions(requestUrl)));
      return true;
    }

    if (requestUrl.pathname === "/api/live/position-status") {
      const { portfolioResponse, exposure } = await portfolioExposureForPositionStatus();
      const position = await getPositionStatusResponse(exposure, { refresh: requestUrl.searchParams.get("refresh") === "1" });
      sendJson(response, 200, {
        ...position,
        portfolio: portfolioResponse
      });
      return true;
    }

    const historyMatch = requestUrl.pathname.match(/^\/api\/live\/history\/(\d{6})$/);
    if (historyMatch) {
      const limit = Math.min(Math.max(Number(requestUrl.searchParams.get("limit") ?? 260), 20), 500);
      sendJson(response, 200, { symbol: historyMatch[1], bars: await fetchStockHistory(historyMatch[1], limit) });
      return true;
    }

    sendJson(response, 404, { error: "Unknown live data route" });
    return true;
  } catch (error) {
    sendJson(response, 502, {
      error: "LIVE_DATA_PROVIDER_ERROR",
      message: errorMessage(error),
      fallback: "demo"
    });
    return true;
  }
}

export async function handleApiRequest(request: any, response: any, requestUrl: URL): Promise<boolean> {
  if (await handlePaperTradingRequest(request, response, requestUrl)) return true;
  if (await handlePortfolioRequest(request, response, requestUrl)) return true;
  if (await handleLiveRequest(request, response, requestUrl)) return true;
  return false;
}
