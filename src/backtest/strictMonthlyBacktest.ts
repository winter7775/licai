import { analysisScore, analyzeHistory, type DailyBar, type HistoryAnalysis, type SpotStock } from "../live/marketScreener";
import type { RuleResult, SignalType } from "../domain/types";
import {
  calculateRoughPositionSize,
  runMonteCarloFromClosedTrades,
  type RoughBacktestConfig,
  type RoughClosedTrade,
  type RoughEquityPoint,
  type RoughGrade,
  type RoughMonteCarloOptions,
  type RoughMonteCarloResult,
  type RoughPositionSizing,
  type RoughTradeRecord
} from "./roughBacktest";

export interface StrictUniverseItem {
  stock: SpotStock;
  history: DailyBar[];
}

export interface StrictBacktestConfig extends RoughBacktestConfig {
  monthlyPoolSize: number;
  monthlyPoolLookbackDays: number;
}

export interface MonthlyUniverseSnapshot {
  activeMonth: string;
  asOfDate: string;
  symbols: string[];
  rankMetric: "trailing_amount";
}

export interface StrictAuditRecord {
  date: string;
  symbol: string;
  name: string;
  poolAsOfDate: string;
  historyEndDate: string;
  benchmarkEndDate: string;
  decision: "buy_signal" | "trial_signal" | "watch" | "reject" | "held" | "insufficient_history" | "error";
  signalType?: SignalType;
  grade?: RoughGrade;
  score?: number;
  price?: number;
  stopPrice?: number;
  failedHardRules: string[];
  failedRules: string[];
  passedRules: string[];
  reason: string;
}

export interface StrictClosedTrade extends RoughClosedTrade {
  name: string;
  grade: RoughGrade;
  entryPrice: number;
  exitPrice: number;
  holdingDays: number;
  entryReason: string;
  exitReason: string;
}

export interface StrictBacktestResult {
  config: StrictBacktestConfig;
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
  closedTrades: StrictClosedTrade[];
  trades: RoughTradeRecord[];
  equityCurve: RoughEquityPoint[];
  monthlySnapshots: MonthlyUniverseSnapshot[];
  auditSummary: {
    records: number;
    buySignals: number;
    trialSignals: number;
    watch: number;
    rejected: number;
    errors: number;
  };
  warnings: string[];
}

export interface StrictMonteCarloResult extends RoughMonteCarloResult {}

interface Holding {
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  stopPrice: number;
  takeProfitPrice: number;
  grade: RoughGrade;
  entryDate: string;
  entryAmount: number;
  entryPositionPct: number;
  reason: string;
}

interface PendingBuy {
  signalDate: string;
  symbol: string;
  name: string;
  grade: RoughGrade;
  stopPrice: number;
  takeProfitPrice: number;
  reason: string;
  score: number;
}

interface Candidate {
  symbol: string;
  name: string;
  grade: RoughGrade;
  signalType: SignalType;
  score: number;
  price: number;
  stopPrice: number;
  takeProfitPrice: number;
  reason: string;
  rules: RuleResult[];
}

const DEFAULT_CONFIG: StrictBacktestConfig = {
  initialCapital: 200_000,
  warmupDays: 260,
  maxExposurePct: 35,
  maxSinglePositionPct: 10,
  maxTrialSinglePositionPct: 3,
  maxTrialTotalPositionPct: 10,
  maxHoldings: 8,
  minBuyAmount: 5_000,
  lotSize: 100,
  monthlyPoolSize: 800,
  monthlyPoolLookbackDays: 60
};

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function historyIndexByDate(history: DailyBar[]): Map<string, number> {
  return new Map(history.map((bar, index) => [bar.date, index]));
}

function barByDate(history: DailyBar[]): Map<string, DailyBar> {
  return new Map(history.map((bar) => [bar.date, bar]));
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function previousMonthSnapshotsDates(tradeDates: string[]): Array<{ activeMonth: string; asOfDate: string }> {
  const sorted = [...new Set(tradeDates)].sort();
  const result: Array<{ activeMonth: string; asOfDate: string }> = [];
  let previousDate = "";
  let previousMonth = "";
  for (const date of sorted) {
    const currentMonth = monthKey(date);
    if (previousDate && previousMonth && currentMonth !== previousMonth) {
      result.push({ activeMonth: currentMonth, asOfDate: previousDate });
    }
    previousDate = date;
    previousMonth = currentMonth;
  }
  return result;
}

function stockNameIsTradable(name: string): boolean {
  return !/(?:ST|退)/i.test(name) && !/^[NC]/i.test(name);
}

function rankMetricAt(history: DailyBar[], asOfDate: string, lookbackDays: number): number {
  const eligible = history.filter((bar) => bar.date <= asOfDate);
  if (eligible.length === 0) return 0;
  const window = eligible.slice(-Math.max(1, lookbackDays));
  return mean(window.map((bar) => bar.amount)) ?? 0;
}

export function buildMonthlyUniverseSnapshots(input: {
  universe: StrictUniverseItem[];
  tradeDates: string[];
  poolSize?: number;
  lookbackDays?: number;
}): MonthlyUniverseSnapshot[] {
  const poolSize = Math.max(1, Math.floor(input.poolSize ?? DEFAULT_CONFIG.monthlyPoolSize));
  const lookbackDays = Math.max(1, Math.floor(input.lookbackDays ?? DEFAULT_CONFIG.monthlyPoolLookbackDays));
  return previousMonthSnapshotsDates(input.tradeDates).map(({ activeMonth, asOfDate }) => {
    const symbols = input.universe
      .map((item) => {
        const bars = item.history.filter((bar) => bar.date <= asOfDate);
        const latest = bars[bars.length - 1];
        return {
          symbol: item.stock.symbol,
          name: item.stock.name,
          latest,
          metric: rankMetricAt(item.history, asOfDate, lookbackDays)
        };
      })
      .filter((item) => item.latest && item.latest.close >= 5 && item.metric > 0 && stockNameIsTradable(item.name))
      .sort((left, right) => right.metric - left.metric || left.symbol.localeCompare(right.symbol))
      .slice(0, poolSize)
      .map((item) => item.symbol);
    return { activeMonth, asOfDate, symbols, rankMetric: "trailing_amount" };
  });
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

function benchmarkMaxExposure(benchmark: DailyBar[], fallback: number): number {
  if (benchmark.length < 120) return 0;
  const closes = benchmark.map((bar) => bar.close);
  const close = closes[closes.length - 1];
  const ma20 = mean(closes.slice(-20)) ?? close;
  const ma60 = mean(closes.slice(-60)) ?? close;
  const ma120 = mean(closes.slice(-120)) ?? close;
  const ma60Before = mean(closes.slice(-80, -20)) ?? ma60;
  if (close < ma120 * 0.98) return 0;
  if (close >= ma20 && ma20 >= ma60 * 0.99 && ma60 >= ma120 * 0.98 && ma60 >= ma60Before * 0.99) return Math.max(fallback, 60);
  return fallback;
}

function marketValue(holdings: Holding[], quoteFor: (symbol: string) => number | undefined): number {
  return holdings.reduce((sum, holding) => sum + holding.quantity * (quoteFor(holding.symbol) ?? holding.avgCost), 0);
}

function trialMarketValue(holdings: Holding[], quoteFor: (symbol: string) => number | undefined): number {
  return holdings
    .filter((holding) => holding.grade === "B")
    .reduce((sum, holding) => sum + holding.quantity * (quoteFor(holding.symbol) ?? holding.avgCost), 0);
}

function summarizeRules(rules: RuleResult[]): Pick<StrictAuditRecord, "failedHardRules" | "failedRules" | "passedRules"> {
  return {
    failedHardRules: rules.filter((rule) => rule.severity === "hard" && !rule.passed).map((rule) => rule.id),
    failedRules: rules.filter((rule) => !rule.passed).map((rule) => rule.id),
    passedRules: rules.filter((rule) => rule.passed).map((rule) => rule.id)
  };
}

function auditDecision(grade: RoughGrade | null, signalType: SignalType): StrictAuditRecord["decision"] {
  if (grade === "A") return "buy_signal";
  if (grade === "B") return "trial_signal";
  return signalType === "watch" ? "watch" : "reject";
}

function recordAudit(
  onAuditRecord: ((record: StrictAuditRecord) => void) | undefined,
  summary: StrictBacktestResult["auditSummary"],
  record: StrictAuditRecord
): void {
  summary.records += 1;
  if (record.decision === "buy_signal") summary.buySignals += 1;
  if (record.decision === "trial_signal") summary.trialSignals += 1;
  if (record.decision === "watch") summary.watch += 1;
  if (record.decision === "reject" || record.decision === "insufficient_history") summary.rejected += 1;
  if (record.decision === "error") summary.errors += 1;
  onAuditRecord?.(record);
}

function tradeStats(closedTrades: StrictClosedTrade[], initialCapital: number, equityCurve: RoughEquityPoint[]) {
  const finalAssets = equityCurve[equityCurve.length - 1]?.totalAssets ?? initialCapital;
  const years = Math.max(1 / 252, equityCurve.length / 252);
  const wins = closedTrades.filter((trade) => trade.pnl > 0);
  const losses = closedTrades.filter((trade) => trade.pnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  const averageWin = mean(wins.map((trade) => trade.returnPct));
  const averageLoss = mean(losses.map((trade) => trade.returnPct));
  const expectancy = mean(closedTrades.map((trade) => trade.returnPct));
  return {
    finalAssets: round(finalAssets),
    totalReturnPct: round(((finalAssets / initialCapital) - 1) * 100),
    cagrPct: round(((finalAssets / initialCapital) ** (1 / years) - 1) * 100),
    maxDrawdownPct: maxDrawdownFromAssets(equityCurve.map((point) => point.totalAssets)),
    tradeCount: closedTrades.length,
    winRatePct: closedTrades.length > 0 ? round((wins.length / closedTrades.length) * 100) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    averageWinPct: averageWin === null ? null : round(averageWin),
    averageLossPct: averageLoss === null ? null : round(averageLoss),
    expectancyPct: expectancy === null ? null : round(expectancy)
  };
}

export function runStrictMonthlyBacktest(input: {
  universe: StrictUniverseItem[];
  benchmarkBars: DailyBar[];
  config?: Partial<StrictBacktestConfig>;
  analyze?: (stock: SpotStock, bars: DailyBar[], options: { benchmarkBars?: DailyBar[] }) => HistoryAnalysis;
  onAuditRecord?: (record: StrictAuditRecord) => void;
}): StrictBacktestResult {
  const config = { ...DEFAULT_CONFIG, ...input.config };
  const analyze = input.analyze ?? analyzeHistory;
  const benchmarkDates = [...new Set(input.benchmarkBars.map((bar) => bar.date))].sort();
  const monthlySnapshots = buildMonthlyUniverseSnapshots({
    universe: input.universe,
    tradeDates: benchmarkDates,
    poolSize: config.monthlyPoolSize,
    lookbackDays: config.monthlyPoolLookbackDays
  });
  const snapshotByMonth = new Map(monthlySnapshots.map((snapshot) => [snapshot.activeMonth, snapshot]));
  const barMaps = new Map(input.universe.map((item) => [item.stock.symbol, barByDate(item.history)]));
  const indexMaps = new Map(input.universe.map((item) => [item.stock.symbol, historyIndexByDate(item.history)]));
  const stockBySymbol = new Map(input.universe.map((item) => [item.stock.symbol, item.stock]));
  const benchmarkIndex = historyIndexByDate(input.benchmarkBars);
  const startedAt = benchmarkDates[Math.min(config.warmupDays, benchmarkDates.length - 1)] ?? "";
  const endedAt = benchmarkDates[benchmarkDates.length - 1] ?? "";
  let cash = config.initialCapital;
  let holdings: Holding[] = [];
  let peakAssets = config.initialCapital;
  let pendingBuys: PendingBuy[] = [];
  const trades: RoughTradeRecord[] = [];
  const closedTrades: StrictClosedTrade[] = [];
  const equityCurve: RoughEquityPoint[] = [];
  const auditSummary: StrictBacktestResult["auditSummary"] = {
    records: 0,
    buySignals: 0,
    trialSignals: 0,
    watch: 0,
    rejected: 0,
    errors: 0
  };

  for (const date of benchmarkDates.filter((day) => day >= startedAt)) {
    const benchmarkEndIndex = benchmarkIndex.get(date);
    if (benchmarkEndIndex === undefined || benchmarkEndIndex < config.warmupDays) continue;
    const benchmarkHistory = input.benchmarkBars.slice(0, benchmarkEndIndex + 1);
    const quoteFor = (symbol: string) => barMaps.get(symbol)?.get(date)?.close;

    const executableBuys = pendingBuys;
    pendingBuys = [];
    for (const order of executableBuys) {
      if (holdings.length >= config.maxHoldings || holdings.some((holding) => holding.symbol === order.symbol)) continue;
      const executionBar = barMaps.get(order.symbol)?.get(date);
      if (!executionBar || executionBar.open <= 0) continue;
      const currentMv = marketValue(holdings, quoteFor);
      const totalAssets = round(cash + currentMv);
      const sizing: RoughPositionSizing = calculateRoughPositionSize({
        grade: order.grade,
        price: executionBar.open,
        totalAssets,
        cash,
        currentMarketValue: currentMv,
        currentTrialMarketValue: trialMarketValue(holdings, quoteFor),
        maxExposurePct: benchmarkMaxExposure(benchmarkHistory, config.maxExposurePct),
        config
      });
      if (!sizing.canBuy) continue;
      cash = round(cash - sizing.amount);
      holdings.push({
        symbol: order.symbol,
        name: order.name,
        quantity: sizing.quantity,
        avgCost: round(executionBar.open),
        stopPrice: order.stopPrice,
        takeProfitPrice: round(executionBar.open * 1.4),
        grade: order.grade,
        entryDate: date,
        entryAmount: sizing.amount,
        entryPositionPct: sizing.positionPct,
        reason: order.reason
      });
      trades.push({
        symbol: order.symbol,
        name: order.name,
        side: "buy",
        date,
        price: round(executionBar.open),
        quantity: sizing.quantity,
        amount: sizing.amount,
        grade: order.grade,
        reason: `${order.reason}; signalDate=${order.signalDate}; score=${round(order.score)}`,
        positionPct: sizing.positionPct
      });
    }

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
        nextHoldings.push(holding);
        continue;
      }
      const exitPrice = stopHit ? holding.stopPrice : holding.takeProfitPrice;
      const amount = round(holding.quantity * exitPrice);
      const pnl = round((exitPrice - holding.avgCost) * holding.quantity);
      const returnPct = round(((exitPrice / holding.avgCost) - 1) * 100);
      cash = round(cash + amount);
      const exitReason = stopHit ? "stop_loss" : "take_profit";
      trades.push({
        symbol: holding.symbol,
        name: holding.name,
        side: "sell",
        date,
        price: round(exitPrice),
        quantity: holding.quantity,
        amount,
        grade: holding.grade,
        reason: exitReason,
        pnl,
        returnPct,
        positionPct: holding.entryPositionPct
      });
      closedTrades.push({
        symbol: holding.symbol,
        name: holding.name,
        entryDate: holding.entryDate,
        exitDate: date,
        entryPrice: holding.avgCost,
        exitPrice: round(exitPrice),
        holdingDays: Math.max(1, benchmarkDates.indexOf(date) - benchmarkDates.indexOf(holding.entryDate)),
        returnPct,
        positionPct: holding.entryPositionPct,
        pnl,
        grade: holding.grade,
        entryReason: holding.reason,
        exitReason
      });
    }
    holdings = nextHoldings;

    const snapshot = snapshotByMonth.get(monthKey(date));
    const heldSymbols = new Set(holdings.map((holding) => holding.symbol));
    const candidates: Candidate[] = [];
    const maxExposurePct = benchmarkMaxExposure(benchmarkHistory, config.maxExposurePct);
    if (snapshot && maxExposurePct > 0 && holdings.length < config.maxHoldings) {
      for (const symbol of snapshot.symbols) {
        const stock = stockBySymbol.get(symbol);
        if (!stock) continue;
        if (heldSymbols.has(symbol)) {
          recordAudit(input.onAuditRecord, auditSummary, {
            date,
            symbol,
            name: stock.name,
            poolAsOfDate: snapshot.asOfDate,
            historyEndDate: date,
            benchmarkEndDate: date,
            decision: "held",
            failedHardRules: [],
            failedRules: [],
            passedRules: [],
            reason: "already holding"
          });
          continue;
        }
        const itemIndex = indexMaps.get(symbol)?.get(date);
        if (itemIndex === undefined || itemIndex < config.warmupDays) {
          recordAudit(input.onAuditRecord, auditSummary, {
            date,
            symbol,
            name: stock.name,
            poolAsOfDate: snapshot.asOfDate,
            historyEndDate: itemIndex === undefined ? "" : date,
            benchmarkEndDate: date,
            decision: "insufficient_history",
            failedHardRules: ["history.warmup"],
            failedRules: ["history.warmup"],
            passedRules: [],
            reason: "not enough prior bars"
          });
          continue;
        }
        try {
          const history = input.universe.find((item) => item.stock.symbol === symbol)?.history.slice(0, itemIndex + 1) ?? [];
          const current = history[history.length - 1];
          const stockAtDate: SpotStock = {
            ...stock,
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
          const analysis = analyze(stockAtDate, history, { benchmarkBars: benchmarkHistory });
          const grade = candidateGrade(analysis.signalType, analysis.rules, current.close);
          const rules = summarizeRules(analysis.rules);
          const decision = auditDecision(grade, analysis.signalType);
          recordAudit(input.onAuditRecord, auditSummary, {
            date,
            symbol,
            name: stock.name,
            poolAsOfDate: snapshot.asOfDate,
            historyEndDate: current.date,
            benchmarkEndDate: input.benchmarkBars[benchmarkEndIndex]?.date ?? date,
            decision,
            signalType: analysis.signalType,
            grade: grade ?? undefined,
            score: analysisScore(analysis),
            price: current.close,
            stopPrice: analysis.stopPrice,
            ...rules,
            reason: grade ? `${analysis.signalType} signal for next trading day` : rules.failedHardRules[0] ?? "watch only"
          });
          if (!grade) continue;
          candidates.push({
            symbol,
            name: stock.name,
            grade,
            signalType: analysis.signalType,
            score: analysisScore(analysis),
            price: current.close,
            stopPrice: analysis.stopPrice,
            takeProfitPrice: round(current.close * 1.4),
            reason: analysis.signalType,
            rules: analysis.rules
          });
        } catch (error) {
          recordAudit(input.onAuditRecord, auditSummary, {
            date,
            symbol,
            name: stock.name,
            poolAsOfDate: snapshot.asOfDate,
            historyEndDate: date,
            benchmarkEndDate: date,
            decision: "error",
            failedHardRules: ["analysis.error"],
            failedRules: ["analysis.error"],
            passedRules: [],
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    candidates.sort((left, right) => (left.grade === right.grade ? right.score - left.score : left.grade === "A" ? -1 : 1));
    pendingBuys = candidates.map((candidate) => ({
      signalDate: date,
      symbol: candidate.symbol,
      name: candidate.name,
      grade: candidate.grade,
      stopPrice: candidate.stopPrice,
      takeProfitPrice: candidate.takeProfitPrice,
      reason: candidate.reason,
      score: candidate.score
    }));

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

  const stats = tradeStats(closedTrades, config.initialCapital, equityCurve);
  return {
    config,
    startedAt,
    endedAt,
    initialCapital: config.initialCapital,
    ...stats,
    closedTrades,
    trades,
    equityCurve,
    monthlySnapshots,
    auditSummary,
    warnings: [
      "Strict replay uses monthly pools built from prior month-end historical bars only.",
      "Current v1 ranks the monthly top pool by trailing traded amount because historical market-cap/PE point-in-time data is not yet wired.",
      "Signals are generated after the close and executed on the next trading day's open."
    ]
  };
}

export function runStrictMonteCarloFromClosedTrades(
  trades: StrictClosedTrade[],
  options: RoughMonteCarloOptions
): StrictMonteCarloResult {
  return runMonteCarloFromClosedTrades(trades, options);
}
