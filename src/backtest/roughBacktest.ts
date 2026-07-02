import {
  analysisScore,
  analyzeHistory,
  type DailyBar,
  type SpotStock
} from "../live/marketScreener";
import { calculateAtr, calculateProfitProtectionStop, type ProfitProtectionStage } from "../domain/profitProtection";
import type { RuleResult, SignalType } from "../domain/types";
import type { TradeExecutionCostConfig } from "./tradeExecution";

export type RoughGrade = "A" | "B";

export interface RoughBacktestConfig extends TradeExecutionCostConfig {
  initialCapital: number;
  warmupDays: number;
  maxExposurePct: number;
  maxSinglePositionPct: number;
  maxTrialSinglePositionPct: number;
  maxTrialTotalPositionPct: number;
  riskPerTradePct?: number;
  trialRiskPerTradePct?: number;
  maxPortfolioRiskPct?: number;
  healthyTrendExposurePct?: number;
  strongTrendExposurePct?: number;
  maxHoldings: number;
  minBuyAmount: number;
  lotSize: number;
  allowedGrades?: RoughGrade[];
}

export interface RoughPositionSizingInput {
  grade: RoughGrade;
  price: number;
  totalAssets: number;
  cash: number;
  currentMarketValue: number;
  currentTrialMarketValue: number;
  currentPortfolioRiskAmount?: number;
  config: RoughBacktestConfig;
  maxExposurePct?: number;
  stopPrice?: number;
}

export interface RoughPositionSizing {
  canBuy: boolean;
  quantity: number;
  amount: number;
  positionPct: number;
  riskAmount?: number;
  reason:
    | "ok"
    | "no_price"
    | "no_cash"
    | "exposure_full"
    | "trial_budget_full"
    | "portfolio_risk_full"
    | "below_min_buy_amount"
    | "below_lot_size";
}

export interface RoughUniverseItem {
  stock: SpotStock;
  history: DailyBar[];
}

export interface RoughClosedTrade {
  symbol: string;
  entryDate: string;
  exitDate: string;
  returnPct: number;
  positionPct: number;
  pnl: number;
}

export interface RoughTradeRecord {
  symbol: string;
  name: string;
  side: "buy" | "sell";
  date: string;
  price: number;
  quantity: number;
  amount: number;
  grade: RoughGrade;
  reason: string;
  pnl?: number;
  returnPct?: number;
  positionPct?: number;
  fees?: number;
  slippageAmount?: number;
  rawPrice?: number;
  grossAmount?: number;
}

export interface RoughEquityPoint {
  date: string;
  totalAssets: number;
  cash: number;
  marketValue: number;
  exposurePct: number;
  drawdownPct: number;
}

export interface RoughBacktestResult {
  config: RoughBacktestConfig;
  startedAt: string;
  endedAt: string;
  initialCapital: number;
  finalAssets: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
  winRatePct: number;
  profitFactor: number | null;
  averageWinPct: number | null;
  averageLossPct: number | null;
  expectancyPct: number | null;
  closedTrades: RoughClosedTrade[];
  trades: RoughTradeRecord[];
  equityCurve: RoughEquityPoint[];
  warnings: string[];
}

export interface RoughMonteCarloOptions {
  initialCapital: number;
  iterations: number;
  seed: number;
}

export interface RoughMonteCarloResult {
  iterations: number;
  tradeSamplesPerRun: number;
  finalAssets: QuantileSummary;
  maxDrawdownPct: QuantileSummary;
  lossProbabilityPct: number;
  severeDrawdownProbabilityPct: number;
}

interface QuantileSummary {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

interface Holding {
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  initialStopPrice: number;
  stopPrice: number;
  profitStopPrice?: number;
  atrStopPrice?: number;
  highestPriceSinceEntry: number;
  profitProtectionStage?: ProfitProtectionStage;
  protectedProfitPct?: number;
  takeProfitPrice: number;
  grade: RoughGrade;
  entryDate: string;
  entryAmount: number;
  entryPositionPct: number;
  reason: string;
}

interface Candidate {
  symbol: string;
  name: string;
  industry: string;
  price: number;
  signalType: SignalType;
  score: number;
  stopPrice: number;
  takeProfitPrice: number;
  grade: RoughGrade;
  reason: string;
  rules: RuleResult[];
}

const DEFAULT_CONFIG: RoughBacktestConfig = {
  initialCapital: 200_000,
  warmupDays: 260,
  maxExposurePct: 35,
  maxSinglePositionPct: 10,
  maxTrialSinglePositionPct: 3,
  maxTrialTotalPositionPct: 10,
  riskPerTradePct: 1,
  trialRiskPerTradePct: 0.3,
  maxPortfolioRiskPct: 6,
  healthyTrendExposurePct: 70,
  strongTrendExposurePct: 90,
  maxHoldings: 8,
  minBuyAmount: 5_000,
  lotSize: 100
};

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * (sorted.length - 1))));
  return round(sorted[index]);
}

function quantiles(values: number[]): QuantileSummary {
  return {
    p5: percentile(values, 5),
    p25: percentile(values, 25),
    p50: percentile(values, 50),
    p75: percentile(values, 75),
    p95: percentile(values, 95)
  };
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

function rulePassed(rules: RuleResult[], id: string): boolean {
  return rules.find((rule) => rule.id === id)?.passed === true;
}

function hardRulesPassed(rules: RuleResult[]): boolean {
  return rules.every((rule) => rule.severity !== "hard" || rule.passed);
}

function platformQualityPassCount(rules: RuleResult[]): number {
  return ["base.volume_contraction", "base.atr_contraction", "base.volatility_contraction"].filter((id) => rulePassed(rules, id)).length;
}

function parseBreakoutActual(rules: RuleResult[]): { extensionPct: number | null; volumeRatio: number | null } {
  const actual = String(rules.find((rule) => rule.id === "buy.breakout")?.actual ?? "");
  const numbers = Array.from(actual.matchAll(/-?\d+(?:\.\d+)?/g))
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value));
  return {
    extensionPct: numbers[0] ?? null,
    volumeRatio: numbers[1] ?? null
  };
}

function candidateGrade(signalType: SignalType, rules: RuleResult[], price: number): RoughGrade | null {
  if (price <= 0 || !hardRulesPassed(rules)) return null;
  if (signalType !== "watch") return "A";
  if (!rulePassed(rules, "trend.template")) return null;
  if (!rulePassed(rules, "quality.valuation")) return null;
  if (!rulePassed(rules, "relative_strength")) return null;
  if (!rulePassed(rules, "risk.stop_loss_width")) return null;
  if (!rulePassed(rules, "base.range")) return null;
  if (platformQualityPassCount(rules) < 2) return null;

  const breakout = parseBreakoutActual(rules);
  if (breakout.extensionPct === null || breakout.volumeRatio === null) return null;
  return breakout.extensionPct >= -3 && breakout.extensionPct <= 3 && breakout.volumeRatio >= 0.9 ? "B" : null;
}

function barByDate(history: DailyBar[]): Map<string, DailyBar> {
  return new Map(history.map((bar) => [bar.date, bar]));
}

function historyIndexByDate(history: DailyBar[]): Map<string, number> {
  return new Map(history.map((bar, index) => [bar.date, index]));
}

function marketValue(holdings: Holding[], quoteFor: (symbol: string) => number | undefined): number {
  return holdings.reduce((sum, holding) => sum + holding.quantity * (quoteFor(holding.symbol) ?? holding.avgCost), 0);
}

function trialMarketValue(holdings: Holding[], quoteFor: (symbol: string) => number | undefined): number {
  return holdings
    .filter((holding) => holding.grade === "B")
    .reduce((sum, holding) => sum + holding.quantity * (quoteFor(holding.symbol) ?? holding.avgCost), 0);
}

function portfolioRiskAmount(holdings: Holding[]): number {
  return holdings.reduce((sum, holding) => sum + Math.max(0, holding.avgCost - holding.stopPrice) * holding.quantity, 0);
}

function stopReason(holding: Holding): string {
  return holding.stopPrice > holding.initialStopPrice ? "profit_protection_stop" : "stop_loss";
}

function refreshHoldingRisk(holding: Holding, history: DailyBar[], currentBar: DailyBar): Holding {
  const highestPrice = Math.max(holding.highestPriceSinceEntry, currentBar.high);
  const atr = history.length >= 2 ? calculateAtr(history, 22) : undefined;
  const protection = calculateProfitProtectionStop({
    entryPrice: holding.avgCost,
    initialStopPrice: holding.initialStopPrice,
    currentStopPrice: holding.stopPrice,
    highestPrice,
    atr
  });
  return {
    ...holding,
    stopPrice: protection.effectiveStopPrice,
    profitStopPrice: protection.profitStopPrice,
    atrStopPrice: protection.atrStopPrice,
    highestPriceSinceEntry: protection.highestPrice,
    profitProtectionStage: protection.stage,
    protectedProfitPct: protection.protectedProfitPct
  };
}

function maxDrawdownFromAssets(values: number[]): number {
  let peak = values[0] ?? 0;
  let maxDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - value) / peak) * 100);
  }
  return round(maxDrawdown);
}

export function calculateBenchmarkExposureLimit(benchmark: DailyBar[], config: RoughBacktestConfig): number {
  if (benchmark.length < 120) return 0;
  const closes = benchmark.map((bar) => bar.close);
  const close = closes[closes.length - 1];
  const ma20 = mean(closes.slice(-20)) ?? close;
  const ma60 = mean(closes.slice(-60)) ?? close;
  const ma120 = mean(closes.slice(-120)) ?? close;
  const ma60Before = mean(closes.slice(-80, -20)) ?? ma60;
  if (close < ma120 * 0.98) return 0;
  if (close >= ma20 && ma20 >= ma60 && ma60 >= ma120 && close >= ma120 * 1.05 && ma60 >= ma60Before) {
    return Math.max(config.maxExposurePct, config.strongTrendExposurePct ?? 90);
  }
  if (close >= ma60 && ma20 >= ma60 * 0.99 && ma60 >= ma120 * 0.98 && ma60 >= ma60Before * 0.99) {
    return Math.max(config.maxExposurePct, config.healthyTrendExposurePct ?? 70);
  }
  return config.maxExposurePct;
}

function benchmarkMaxExposure(benchmark: DailyBar[], config: RoughBacktestConfig): number {
  return calculateBenchmarkExposureLimit(benchmark, config);
}

export function calculateRoughPositionSize(input: RoughPositionSizingInput): RoughPositionSizing {
  const maxExposurePct = input.maxExposurePct ?? input.config.maxExposurePct;
  if (input.price <= 0) return { canBuy: false, quantity: 0, amount: 0, positionPct: 0, reason: "no_price" };
  if (input.cash <= 0) return { canBuy: false, quantity: 0, amount: 0, positionPct: 0, reason: "no_cash" };

  const remainingExposure = Math.max(0, input.totalAssets * (maxExposurePct / 100) - input.currentMarketValue);
  if (remainingExposure <= 0) return { canBuy: false, quantity: 0, amount: 0, positionPct: 0, reason: "exposure_full" };

  const remainingTrial =
    input.grade === "B"
      ? Math.max(0, input.totalAssets * (input.config.maxTrialTotalPositionPct / 100) - input.currentTrialMarketValue)
      : Number.POSITIVE_INFINITY;
  if (remainingTrial <= 0) return { canBuy: false, quantity: 0, amount: 0, positionPct: 0, reason: "trial_budget_full" };

  const targetPct = input.grade === "B" ? input.config.maxTrialSinglePositionPct : input.config.maxSinglePositionPct;
  const stopRiskPct =
    input.stopPrice !== undefined && input.stopPrice > 0 && input.price > input.stopPrice
      ? (input.price - input.stopPrice) / input.price
      : null;
  const perTradeRiskPct = input.grade === "B" ? input.config.trialRiskPerTradePct ?? 0.3 : input.config.riskPerTradePct ?? 1;
  const remainingPortfolioRisk =
    stopRiskPct === null
      ? Number.POSITIVE_INFINITY
      : input.totalAssets * ((input.config.maxPortfolioRiskPct ?? 6) / 100) - (input.currentPortfolioRiskAmount ?? 0);
  if (remainingPortfolioRisk <= 0) {
    return { canBuy: false, quantity: 0, amount: 0, positionPct: 0, riskAmount: 0, reason: "portfolio_risk_full" };
  }
  const riskBasedAmount = stopRiskPct === null ? Number.POSITIVE_INFINITY : (input.totalAssets * (perTradeRiskPct / 100)) / stopRiskPct;
  const portfolioRiskCappedAmount = stopRiskPct === null ? Number.POSITIVE_INFINITY : remainingPortfolioRisk / stopRiskPct;
  const targetAmount = Math.min(
    input.totalAssets * (targetPct / 100),
    riskBasedAmount,
    portfolioRiskCappedAmount,
    remainingExposure,
    remainingTrial,
    input.cash
  );
  const quantity = Math.floor(targetAmount / input.price / input.config.lotSize) * input.config.lotSize;
  const amount = round(quantity * input.price);
  const riskAmount = stopRiskPct === null ? undefined : round(amount * stopRiskPct);
  const positionPct = input.totalAssets > 0 ? round((amount / input.totalAssets) * 100) : 0;
  if (amount < input.config.minBuyAmount) {
    return { canBuy: false, quantity, amount, positionPct, riskAmount, reason: "below_min_buy_amount" };
  }
  if (quantity <= 0) return { canBuy: false, quantity: 0, amount: 0, positionPct: 0, riskAmount, reason: "below_lot_size" };
  return { canBuy: true, quantity, amount, positionPct, riskAmount, reason: "ok" };
}

export function runMonteCarloFromClosedTrades(
  trades: RoughClosedTrade[],
  options: RoughMonteCarloOptions
): RoughMonteCarloResult {
  const rng = createRng(options.seed);
  const finalAssets: number[] = [];
  const drawdowns: number[] = [];
  if (trades.length === 0) {
    return {
      iterations: options.iterations,
      tradeSamplesPerRun: 0,
      finalAssets: quantiles([options.initialCapital]),
      maxDrawdownPct: quantiles([0]),
      lossProbabilityPct: 0,
      severeDrawdownProbabilityPct: 0
    };
  }

  for (let index = 0; index < options.iterations; index += 1) {
    let assets = options.initialCapital;
    const path = [assets];
    for (let tradeIndex = 0; tradeIndex < trades.length; tradeIndex += 1) {
      const sample = trades[Math.floor(rng() * trades.length)];
      assets *= 1 + (sample.positionPct / 100) * (sample.returnPct / 100);
      path.push(assets);
    }
    finalAssets.push(round(assets));
    drawdowns.push(maxDrawdownFromAssets(path));
  }

  return {
    iterations: options.iterations,
    tradeSamplesPerRun: trades.length,
    finalAssets: quantiles(finalAssets),
    maxDrawdownPct: quantiles(drawdowns),
    lossProbabilityPct: round((finalAssets.filter((value) => value < options.initialCapital).length / finalAssets.length) * 100),
    severeDrawdownProbabilityPct: round((drawdowns.filter((value) => value >= 30).length / drawdowns.length) * 100)
  };
}

export function runRoughBacktest(input: {
  universe: RoughUniverseItem[];
  benchmarkBars: DailyBar[];
  config?: Partial<RoughBacktestConfig>;
  startedAt?: string;
  endedAt?: string;
}): RoughBacktestResult {
  const config = { ...DEFAULT_CONFIG, ...input.config };
  const warnings = [
    "Rough test uses the current stock universe and current static valuation/market-cap fields, so survivorship and look-ahead bias exist.",
    "Rough test buys on signal-day close and assumes stop-loss is hit before take-profit if both are touched intraday."
  ];
  const benchmarkDates = input.benchmarkBars.map((bar) => bar.date);
  const startedAt = input.startedAt ?? benchmarkDates[Math.min(config.warmupDays, benchmarkDates.length - 1)] ?? "";
  const endedAt = input.endedAt ?? benchmarkDates[benchmarkDates.length - 1] ?? "";
  const selectedDates = benchmarkDates.filter((date) => date >= startedAt && date <= endedAt);
  const historyBySymbol = new Map(input.universe.map((item) => [item.stock.symbol, item.history]));
  const barMaps = new Map(input.universe.map((item) => [item.stock.symbol, barByDate(item.history)]));
  const indexMaps = new Map(input.universe.map((item) => [item.stock.symbol, historyIndexByDate(item.history)]));
  const benchmarkIndex = historyIndexByDate(input.benchmarkBars);
  let cash = config.initialCapital;
  let holdings: Holding[] = [];
  let peakAssets = config.initialCapital;
  const trades: RoughTradeRecord[] = [];
  const closedTrades: RoughClosedTrade[] = [];
  const equityCurve: RoughEquityPoint[] = [];

  for (const date of selectedDates) {
    const quoteFor = (symbol: string) => barMaps.get(symbol)?.get(date)?.close;
    const benchmarkEndIndex = benchmarkIndex.get(date);
    if (benchmarkEndIndex === undefined || benchmarkEndIndex < config.warmupDays) continue;

    const nextHoldings: Holding[] = [];
    for (const holding of holdings) {
      const bar = barMaps.get(holding.symbol)?.get(date);
      if (!bar) {
        nextHoldings.push(holding);
        continue;
      }
      const stopHit = bar.low <= holding.stopPrice;
      const takeProfitHit = bar.high >= holding.takeProfitPrice;
      if (!stopHit && !takeProfitHit) {
        const itemIndex = indexMaps.get(holding.symbol)?.get(date);
        const history = itemIndex === undefined ? [bar] : (historyBySymbol.get(holding.symbol)?.slice(0, itemIndex + 1) ?? [bar]);
        nextHoldings.push(refreshHoldingRisk(holding, history, bar));
        continue;
      }
      const exitPrice = stopHit ? holding.stopPrice : holding.takeProfitPrice;
      const amount = round(holding.quantity * exitPrice);
      const pnl = round((exitPrice - holding.avgCost) * holding.quantity);
      const returnPct = round(((exitPrice / holding.avgCost) - 1) * 100);
      cash = round(cash + amount);
      trades.push({
        symbol: holding.symbol,
        name: holding.name,
        side: "sell",
        date,
        price: round(exitPrice),
        quantity: holding.quantity,
        amount,
        grade: holding.grade,
        reason: stopHit ? stopReason(holding) : "take_profit",
        pnl,
        returnPct,
        positionPct: holding.entryPositionPct
      });
      closedTrades.push({
        symbol: holding.symbol,
        entryDate: holding.entryDate,
        exitDate: date,
        returnPct,
        positionPct: holding.entryPositionPct,
        pnl
      });
    }
    holdings = nextHoldings;

    const currentMarketValue = marketValue(holdings, quoteFor);
    const totalAssetsBeforeBuys = round(cash + currentMarketValue);
    const maxExposurePct = benchmarkMaxExposure(input.benchmarkBars.slice(0, benchmarkEndIndex + 1), config);
    const heldSymbols = new Set(holdings.map((holding) => holding.symbol));
    const candidates: Candidate[] = [];

    if (maxExposurePct > 0 && holdings.length < config.maxHoldings) {
      for (const item of input.universe) {
        if (heldSymbols.has(item.stock.symbol)) continue;
        const itemIndex = indexMaps.get(item.stock.symbol)?.get(date);
        if (itemIndex === undefined || itemIndex < config.warmupDays) continue;
        const history = item.history.slice(0, itemIndex + 1);
        const benchmarkHistory = input.benchmarkBars.slice(0, benchmarkEndIndex + 1);
        try {
          const current = history[history.length - 1];
          const stockAtDate: SpotStock = {
            ...item.stock,
            price: current.close,
            changePct: current.changePct,
            changeAmount: current.changeAmount,
            volume: current.volume,
            amount: current.amount,
            turnoverRate: current.turnoverRate,
            high: current.high,
            low: current.low,
            open: current.open,
            previousClose: current.close - current.changeAmount
          };
          const analysis = analyzeHistory(stockAtDate, history, { benchmarkBars: benchmarkHistory });
          const grade = candidateGrade(analysis.signalType, analysis.rules, current.close);
          if (!grade) continue;
          if (config.allowedGrades && !config.allowedGrades.includes(grade)) continue;
          candidates.push({
            symbol: item.stock.symbol,
            name: item.stock.name,
            industry: item.stock.industry,
            price: current.close,
            signalType: analysis.signalType,
            score: analysisScore(analysis),
            stopPrice: analysis.stopPrice,
            takeProfitPrice: round(current.close * 1.4),
            grade,
            reason: analysis.signalType,
            rules: analysis.rules
          });
        } catch {
          // A rough batch should continue when a single historical window is unusable.
        }
      }
    }

    candidates.sort((left, right) => (left.grade === right.grade ? right.score - left.score : left.grade === "A" ? -1 : 1));

    for (const candidate of candidates) {
      if (holdings.length >= config.maxHoldings) break;
      if (holdings.some((holding) => holding.symbol === candidate.symbol)) continue;
      const quote = (symbol: string) => (symbol === candidate.symbol ? candidate.price : quoteFor(symbol));
      const currentMv = marketValue(holdings, quote);
      const totalAssets = round(cash + currentMv);
      const sizing = calculateRoughPositionSize({
        grade: candidate.grade,
        price: candidate.price,
        totalAssets,
        cash,
        currentMarketValue: currentMv,
        currentTrialMarketValue: trialMarketValue(holdings, quote),
        currentPortfolioRiskAmount: portfolioRiskAmount(holdings),
        maxExposurePct,
        config,
        stopPrice: candidate.stopPrice
      });
      if (!sizing.canBuy) continue;
      cash = round(cash - sizing.amount);
      holdings.push({
        symbol: candidate.symbol,
        name: candidate.name,
        quantity: sizing.quantity,
        avgCost: round(candidate.price),
        initialStopPrice: candidate.stopPrice,
        stopPrice: candidate.stopPrice,
        highestPriceSinceEntry: round(candidate.price),
        profitProtectionStage: "initial",
        protectedProfitPct: 0,
        takeProfitPrice: candidate.takeProfitPrice,
        grade: candidate.grade,
        entryDate: date,
        entryAmount: sizing.amount,
        entryPositionPct: sizing.positionPct,
        reason: candidate.reason
      });
      trades.push({
        symbol: candidate.symbol,
        name: candidate.name,
        side: "buy",
        date,
        price: round(candidate.price),
        quantity: sizing.quantity,
        amount: sizing.amount,
        grade: candidate.grade,
        reason: candidate.reason,
        positionPct: sizing.positionPct
      });
    }

    const endingMarketValue = marketValue(holdings, quoteFor);
    const totalAssets = round(cash + endingMarketValue);
    peakAssets = Math.max(peakAssets, totalAssets);
    equityCurve.push({
      date,
      totalAssets,
      cash: round(cash),
      marketValue: round(endingMarketValue),
      exposurePct: totalAssets > 0 ? round((endingMarketValue / totalAssets) * 100) : 0,
      drawdownPct: peakAssets > 0 ? round(((peakAssets - totalAssets) / peakAssets) * 100) : 0
    });
  }

  const finalAssets = equityCurve[equityCurve.length - 1]?.totalAssets ?? config.initialCapital;
  const years = Math.max(1 / 252, equityCurve.length / 252);
  const wins = closedTrades.filter((trade) => trade.pnl > 0);
  const losses = closedTrades.filter((trade) => trade.pnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  const avgWin = mean(wins.map((trade) => trade.returnPct));
  const avgLoss = mean(losses.map((trade) => trade.returnPct));
  const expectancy = mean(closedTrades.map((trade) => trade.returnPct));

  return {
    config,
    startedAt,
    endedAt,
    initialCapital: config.initialCapital,
    finalAssets: round(finalAssets),
    totalReturnPct: round(((finalAssets / config.initialCapital) - 1) * 100),
    cagrPct: round(((finalAssets / config.initialCapital) ** (1 / years) - 1) * 100),
    maxDrawdownPct: maxDrawdownFromAssets(equityCurve.map((point) => point.totalAssets)),
    tradeCount: closedTrades.length,
    winRatePct: closedTrades.length > 0 ? round((wins.length / closedTrades.length) * 100) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    averageWinPct: avgWin === null ? null : round(avgWin),
    averageLossPct: avgLoss === null ? null : round(avgLoss),
    expectancyPct: expectancy === null ? null : round(expectancy),
    closedTrades,
    trades,
    equityCurve,
    warnings
  };
}
