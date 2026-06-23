import { calculateStopLossWidthPct, evaluateStopLossRule, scoreSignalRules } from "../domain/ruleEngine";
import type { RuleResult, SignalType } from "../domain/types";

export interface SpotStock {
  symbol: string;
  name: string;
  industry: string;
  price: number;
  changePct: number;
  changeAmount: number;
  volume: number;
  amount: number;
  turnoverRate: number;
  peTtm: number;
  volumeRatio: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  totalMarketCap: number;
  floatMarketCap: number;
}

export interface DailyBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  amplitudePct: number;
  changePct: number;
  changeAmount: number;
  turnoverRate: number;
}

export interface HistoryAnalysis {
  signalType: SignalType;
  pivotPrice: number;
  baseLow: number;
  baseRangePct: number;
  stopPrice: number;
  stopLossWidthPct: number;
  buyExtensionPct: number;
  ma20: number;
  ma60: number;
  ma120: number;
  rules: RuleResult[];
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function max(values: number[]): number {
  return Math.max(...values);
}

function min(values: number[]): number {
  return Math.min(...values);
}

function percentageChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current / previous) - 1) * 100;
}

function closeLocation(bar: DailyBar): number {
  if (bar.high === bar.low) return 1;
  return (bar.close - bar.low) / (bar.high - bar.low);
}

function trueRange(current: DailyBar, previous?: DailyBar): number {
  if (!previous) return current.high - current.low;
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - previous.close),
    Math.abs(current.low - previous.close)
  );
}

function atrSeries(bars: DailyBar[], period: number): number[] {
  return bars.map((_, index) => {
    const start = Math.max(0, index - period + 1);
    const ranges = bars.slice(start, index + 1).map((bar, offset) => trueRange(bar, bars[start + offset - 1]));
    return mean(ranges);
  });
}

function returnSeries(bars: DailyBar[]): number[] {
  return bars.slice(1).map((bar, index) => percentageChange(bar.close, bars[index].close));
}

export function parseEastmoneySpotRow(row: Record<string, unknown>): SpotStock {
  return {
    symbol: String(row.f12 ?? ""),
    name: String(row.f14 ?? ""),
    industry: String(row.f100 ?? "未分类"),
    price: numberValue(row.f2),
    changePct: numberValue(row.f3),
    changeAmount: numberValue(row.f4),
    volume: numberValue(row.f5),
    amount: numberValue(row.f6),
    turnoverRate: numberValue(row.f8),
    peTtm: numberValue(row.f9),
    volumeRatio: numberValue(row.f10),
    high: numberValue(row.f15),
    low: numberValue(row.f16),
    open: numberValue(row.f17),
    previousClose: numberValue(row.f18),
    totalMarketCap: numberValue(row.f20),
    floatMarketCap: numberValue(row.f21)
  };
}

export function parseSinaSpotRow(row: Record<string, unknown>): SpotStock {
  return {
    symbol: String(row.code ?? "").padStart(6, "0"),
    name: String(row.name ?? ""),
    industry: "未分类",
    price: round(numberValue(row.trade)),
    changePct: round(numberValue(row.changepercent)),
    changeAmount: round(numberValue(row.pricechange)),
    volume: numberValue(row.volume),
    amount: round(numberValue(row.amount)),
    turnoverRate: round(numberValue(row.turnoverratio), 4),
    peTtm: round(numberValue(row.per), 2),
    volumeRatio: 1,
    high: round(numberValue(row.high)),
    low: round(numberValue(row.low)),
    open: round(numberValue(row.open)),
    previousClose: round(numberValue(row.settlement)),
    totalMarketCap: round(numberValue(row.mktcap) * 10_000),
    floatMarketCap: round(numberValue(row.nmc) * 10_000)
  };
}

export function parseEastmoneyKline(line: string): DailyBar {
  const [date, open, close, high, low, volume, amount, amplitudePct, changePct, changeAmount, turnoverRate] =
    line.split(",");

  return {
    date,
    open: numberValue(open),
    close: numberValue(close),
    high: numberValue(high),
    low: numberValue(low),
    volume: numberValue(volume),
    amount: numberValue(amount),
    amplitudePct: numberValue(amplitudePct),
    changePct: numberValue(changePct),
    changeAmount: numberValue(changeAmount),
    turnoverRate: numberValue(turnoverRate)
  };
}

function marketCapRankValue(stock: SpotStock): number {
  return stock.totalMarketCap > 0 ? stock.totalMarketCap : stock.floatMarketCap;
}

export function selectMarketCapUniverse(stocks: SpotStock[], topPct = 0.3): SpotStock[] {
  const pct = Math.min(Math.max(Number(topPct) || 0.3, 0.01), 1);
  const ranked = stocks.filter((stock) => marketCapRankValue(stock) > 0).sort((left, right) => marketCapRankValue(right) - marketCapRankValue(left));
  return ranked.slice(0, Math.max(1, Math.ceil(ranked.length * pct)));
}

export function parseTencentQfqRows(rows: unknown[][]): DailyBar[] {
  return rows.map((row, index) => {
    const date = String(row[0] ?? "");
    const open = numberValue(row[1]);
    const close = numberValue(row[2]);
    const high = numberValue(row[3]);
    const low = numberValue(row[4]);
    const volume = numberValue(row[5]);
    const previousClose = index > 0 ? numberValue(rows[index - 1][2]) : open;
    const amountWan = numberValue(row[8]);
    const changeAmount = close - previousClose;

    return {
      date,
      open,
      close,
      high,
      low,
      volume,
      amount: round(amountWan * 10_000),
      amplitudePct: numberValue(row[7]),
      changePct: round(percentageChange(close, previousClose)),
      changeAmount: round(changeAmount),
      turnoverRate: 0
    };
  });
}

interface PrefilterOptions {
  coreLimit?: number;
  rotationSeed?: string;
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function prefilterSpotStocks(stocks: SpotStock[], limit = 40, options: PrefilterOptions = {}): SpotStock[] {
  const ranked = stocks
    .filter((stock) => !/(?:ST|退|N|C)/i.test(stock.name))
    .filter((stock) => stock.price >= 5)
    .filter((stock) => stock.amount >= 100_000_000)
    .filter((stock) => stock.floatMarketCap >= 5_000_000_000)
    .filter((stock) => stock.turnoverRate > 0 && stock.turnoverRate <= 20)
    .filter((stock) => stock.changePct >= -8 && stock.changePct <= 9.8)
    .sort((left, right) => {
      const score = (stock: SpotStock) => {
        const valuationQuality = stock.peTtm > 0 && stock.peTtm <= 80 ? 0.3 : 0;
        const dailyMoveQuality = stock.changePct >= -3 && stock.changePct <= 8 ? 0.2 : 0;
        return Math.log10(stock.amount) + Math.log10(marketCapRankValue(stock)) * 0.15 + Math.min(stock.volumeRatio, 3) * 0.2 + valuationQuality + dailyMoveQuality;
      };
      const leftScore = score(left);
      const rightScore = score(right);
      return rightScore - leftScore;
    });
  const boundedLimit = Math.max(1, Math.floor(limit));
  const coreLimit = Math.min(Math.max(1, Math.floor(options.coreLimit ?? boundedLimit)), boundedLimit);
  if (boundedLimit <= coreLimit || ranked.length <= coreLimit) return ranked.slice(0, boundedLimit);

  const core = ranked.slice(0, coreLimit);
  const seed = options.rotationSeed?.trim() || new Date().toISOString().slice(0, 10);
  const supplemental = ranked
    .slice(coreLimit)
    .sort((left, right) => stableHash(`${seed}:${left.symbol}`) - stableHash(`${seed}:${right.symbol}`))
    .slice(0, boundedLimit - core.length);

  return [...core, ...supplemental];
}

export function evaluatePlatformSetup(input: {
  baseRangePct: number;
  volumeRatio: number;
  atrRatio: number;
  volatilityRatio: number;
}): { rangePassed: boolean; qualityPassCount: number; passed: boolean } {
  const rangePassed = input.baseRangePct <= 35;
  const qualityPassCount = [input.volumeRatio <= 1.05, input.atrRatio <= 1.1, input.volatilityRatio <= 1.05].filter(Boolean).length;
  return {
    rangePassed,
    qualityPassCount,
    passed: rangePassed && qualityPassCount >= 2
  };
}

export function isBreakoutConfirmation(input: {
  extensionPct: number;
  volume20Ratio: number;
  volume60Ratio: number;
  closeLocation: number;
  changePct: number;
}): boolean {
  return (
    input.extensionPct >= -0.5 &&
    input.extensionPct <= 8 &&
    input.volume20Ratio >= 1.15 &&
    input.volume60Ratio >= 1 &&
    input.closeLocation >= 0.55 &&
    input.changePct <= 8
  );
}

export function evaluateTrendTemplate(input: {
  close: number;
  ma20: number;
  ma60: number;
  ma60TwentyDaysAgo: number;
  ma120: number;
  longLow: number;
  longHigh: number;
}): boolean {
  return (
    input.close >= input.ma60 * 0.98 &&
    input.ma20 >= input.ma60 * 0.98 &&
    input.ma60 >= input.ma60TwentyDaysAgo * 0.99 &&
    input.close >= input.ma120 * 0.98 &&
    input.close >= input.longLow * 1.2 &&
    input.close >= input.longHigh * 0.7
  );
}

function findPullbackSignal(bars: DailyBar[], current: DailyBar): { passed: boolean; pivot: number; breakoutIndex: number } {
  const currentIndex = bars.length - 1;

  for (let index = currentIndex - 3; index >= Math.max(40, currentIndex - 15); index -= 1) {
    const historyBeforeBreakout = bars.slice(0, index);
    const historyThroughBreakout = bars.slice(0, index + 1);
    const previousBase = historyBeforeBreakout.slice(-40);
    const pivot = max(previousBase.map((bar) => bar.close));
    const baseLow = min(previousBase.map((bar) => bar.close));
    const breakout = bars[index];
    const volume10 = mean(historyBeforeBreakout.slice(-10).map((bar) => bar.volume));
    const volume20 = mean(historyBeforeBreakout.slice(-20).map((bar) => bar.volume));
    const volume50 = mean(historyBeforeBreakout.slice(-50).map((bar) => bar.volume));
    const volume60 = mean(historyBeforeBreakout.slice(-60).map((bar) => bar.volume));
    const breakoutCloses = historyThroughBreakout.map((bar) => bar.close);
    const breakoutMa20 = mean(breakoutCloses.slice(-20));
    const breakoutMa60 = mean(breakoutCloses.slice(-60));
    const breakoutMa120 = mean(breakoutCloses.slice(-120));
    const breakoutMa60TwentyDaysAgo = mean(breakoutCloses.slice(-80, -20));
    const atrValues = atrSeries(historyBeforeBreakout, 14);
    const atr14 = atrValues[atrValues.length - 1] ?? 0;
    const atrAverage50 = mean(atrValues.slice(-50));
    const returns = returnSeries(historyBeforeBreakout);
    const volatility20 = standardDeviation(returns.slice(-20));
    const volatility60 = standardDeviation(returns.slice(-60));
    const qualifiedPlatform = evaluatePlatformSetup({
      baseRangePct: percentageChange(pivot, baseLow),
      volumeRatio: volume50 === 0 ? 0 : volume10 / volume50,
      atrRatio: atrAverage50 === 0 ? 0 : atr14 / atrAverage50,
      volatilityRatio: volatility60 === 0 ? 0 : volatility20 / volatility60
    }).passed;
    const breakoutLongWindow = breakoutCloses.slice(-250);
    const qualifiedTrend = evaluateTrendTemplate({
      close: breakout.close,
      ma20: breakoutMa20,
      ma60: breakoutMa60,
      ma60TwentyDaysAgo: breakoutMa60TwentyDaysAgo,
      ma120: breakoutMa120,
      longLow: min(breakoutLongWindow),
      longHigh: max(breakoutLongWindow)
    });
    const isBreakout =
      qualifiedPlatform &&
      qualifiedTrend &&
      isBreakoutConfirmation({
        extensionPct: percentageChange(breakout.close, pivot),
        volume20Ratio: volume20 === 0 ? 0 : breakout.volume / volume20,
        volume60Ratio: volume60 === 0 ? 0 : breakout.volume / volume60,
        closeLocation: closeLocation(breakout),
        changePct: breakout.changePct
      });

    if (!isBreakout) continue;

    const sinceBreakout = bars.slice(index + 1);
    const averagePullbackVolume = mean(sinceBreakout.map((bar) => bar.volume));
    const highestClose = max(bars.slice(index, currentIndex + 1).map((bar) => bar.close));
    const ma20 = mean(bars.slice(-20).map((bar) => bar.close));
    const passed =
      current.low <= pivot * 1.03 &&
      current.close >= pivot * 0.98 &&
      current.close >= ma20 * 0.98 &&
      averagePullbackVolume <= breakout.volume * 0.75 &&
      current.close >= highestClose * 0.9 &&
      current.close > current.open &&
      closeLocation(current) >= 0.6;

    return { passed, pivot, breakoutIndex: index };
  }

  return { passed: false, pivot: 0, breakoutIndex: -1 };
}

export function analyzeHistory(stock: SpotStock, bars: DailyBar[]): HistoryAnalysis {
  if (bars.length < 120) {
    throw new Error(`${stock.symbol} history requires at least 120 daily bars`);
  }

  const current = bars[bars.length - 1];
  const priorBars = bars.slice(0, -1);
  const prior40 = priorBars.slice(-40);
  const prior50 = priorBars.slice(-50);
  const prior60 = priorBars.slice(-60);
  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const pivotPrice = max(prior40.map((bar) => bar.close));
  const baseLow = min(prior40.map((bar) => bar.close));
  const baseRangePct = percentageChange(pivotPrice, baseLow);
  const ma20 = mean(closes.slice(-20));
  const ma60 = mean(closes.slice(-60));
  const ma120 = mean(closes.slice(-120));
  const ma60TwentyDaysAgo = mean(closes.slice(-80, -20));
  const availableLongWindow = closes.slice(-250);
  const longLow = min(availableLongWindow);
  const longHigh = max(availableLongWindow);
  const averageVolume10 = mean(priorBars.slice(-10).map((bar) => bar.volume));
  const averageVolume20 = mean(priorBars.slice(-20).map((bar) => bar.volume));
  const averageVolume50 = mean(prior50.map((bar) => bar.volume));
  const averageVolume60 = mean(prior60.map((bar) => bar.volume));
  const atr14Values = atrSeries(bars, 14);
  const atr14 = atr14Values[atr14Values.length - 1] ?? 0;
  const atr14Average50 = mean(atr14Values.slice(-50));
  const returns = returnSeries(bars);
  const volatility20 = standardDeviation(returns.slice(-20));
  const volatility60 = standardDeviation(returns.slice(-60));
  const trendPassed = evaluateTrendTemplate({
    close: current.close,
    ma20,
    ma60,
    ma60TwentyDaysAgo,
    ma120,
    longLow,
    longHigh
  });
  const volumeRatio = averageVolume50 === 0 ? 0 : averageVolume10 / averageVolume50;
  const atrRatio = atr14Average50 === 0 ? 0 : atr14 / atr14Average50;
  const volatilityRatio = volatility60 === 0 ? 0 : volatility20 / volatility60;
  const platformVolumePassed = volumeRatio <= 1.05;
  const platformAtrPassed = atrRatio <= 1.1;
  const platformVolatilityPassed = volatilityRatio <= 1.05;
  const platformSetup = evaluatePlatformSetup({ baseRangePct, volumeRatio, atrRatio, volatilityRatio });
  const breakoutPassed = isBreakoutConfirmation({
    extensionPct: percentageChange(current.close, pivotPrice),
    volume20Ratio: averageVolume20 === 0 ? 0 : current.volume / averageVolume20,
    volume60Ratio: averageVolume60 === 0 ? 0 : current.volume / averageVolume60,
    closeLocation: closeLocation(current),
    changePct: current.changePct
  });
  const pullback = findPullbackSignal(bars, current);
  const signalType: SignalType =
    trendPassed && platformSetup.passed && breakoutPassed
      ? "breakout"
      : trendPassed && pullback.passed
        ? "pullback"
        : "watch";
  const effectivePivot = signalType === "pullback" && pullback.pivot > 0 ? pullback.pivot : pivotPrice;
  const recent10Low = min(bars.slice(-10).map((bar) => bar.low));
  const validStopCandidates = [current.close * 0.93, effectivePivot * 0.97, recent10Low * 0.99].filter(
    (candidate) => candidate < current.close
  );
  const stopPrice = max(validStopCandidates.length > 0 ? validStopCandidates : [current.close * 0.93]);
  const stopLossWidthPct = calculateStopLossWidthPct(current.close, stopPrice);
  const buyExtensionPct = percentageChange(current.close, effectivePivot);

  const rules: RuleResult[] = [
    {
      id: "liquidity.prefilter",
      name: "基础流动性",
      actual: `成交额${round(stock.amount / 100_000_000, 1)}亿 / 流通市值${round(stock.floatMarketCap / 100_000_000, 0)}亿`,
      threshold: "成交额>=2亿 / 流通市值>=50亿",
      passed: stock.amount >= 200_000_000 && stock.floatMarketCap >= 5_000_000_000,
      severity: "hard",
      explanation: "来自全市场快照的第一阶段过滤。"
    },
    {
      id: "trend.template",
      name: "趋势模板",
      actual: `收盘${round(current.close)} / MA20 ${round(ma20)} / MA60 ${round(ma60)} / MA120 ${round(ma120)}`,
      threshold: "Close/MA20不低于MA60的98%，MA60较20日前回撤不超1%",
      passed: trendPassed,
      severity: "hard",
      explanation: "只保留已形成右侧中期趋势的标的。"
    },
    {
      id: "base.range",
      name: "40日平台宽度",
      actual: round(baseRangePct),
      threshold: "<= 35%",
      passed: platformSetup.rangePassed,
      severity: signalType === "breakout" ? "hard" : "soft",
      explanation: "Pivot 与 BaseLow 的宽度。"
    },
    {
      id: "base.volume_contraction",
      name: "平台缩量",
      actual: round(averageVolume50 === 0 ? 0 : averageVolume10 / averageVolume50, 2),
      threshold: "<= 1.05",
      passed: platformVolumePassed,
      severity: "soft",
      explanation: "最近10日均量相对50日均量。"
    },
    {
      id: "base.atr_contraction",
      name: "ATR收敛",
      actual: round(atr14Average50 === 0 ? 0 : atr14 / atr14Average50, 2),
      threshold: "<= 1.10",
      passed: platformAtrPassed,
      severity: "soft",
      explanation: "当前ATR14相对其50日均值。"
    },
    {
      id: "base.volatility_contraction",
      name: "波动率收敛",
      actual: round(volatility60 === 0 ? 0 : volatility20 / volatility60, 2),
      threshold: "<= 1.05",
      passed: platformVolatilityPassed,
      severity: "soft",
      explanation: "20日收益波动相对60日收益波动。"
    },
    {
      id: "buy.breakout",
      name: "平台突破",
      actual: `偏离${round(buyExtensionPct)}% / 量比${round(averageVolume20 === 0 ? 0 : current.volume / averageVolume20, 2)}`,
      threshold: "距Pivot -0.5%-8% / VOL20>=1.15 / VOL60>=1.0 / 收盘位置>=0.55",
      passed: breakoutPassed,
      severity: signalType === "breakout" ? "hard" : "info",
      explanation: "平台突破必须同时有价格、量能与收盘位置确认。"
    },
    {
      id: "buy.pullback",
      name: "突破后回踩",
      actual: pullback.passed ? "通过" : "未通过",
      threshold: "突破后3-15日缩量回踩Pivot",
      passed: pullback.passed,
      severity: signalType === "pullback" ? "hard" : "info",
      explanation: "次买点只在已出现突破信号后判断。"
    },
    evaluateStopLossRule(current.close, stopPrice)
  ];

  return {
    signalType,
    pivotPrice: round(effectivePivot),
    baseLow: round(baseLow),
    baseRangePct: round(baseRangePct),
    stopPrice: round(stopPrice),
    stopLossWidthPct,
    buyExtensionPct: round(buyExtensionPct),
    ma20: round(ma20),
    ma60: round(ma60),
    ma120: round(ma120),
    rules
  };
}

export function analysisScore(analysis: HistoryAnalysis): number {
  const ruleScore = scoreSignalRules({ rules: analysis.rules });
  const signalBonus = analysis.signalType === "breakout" ? 20 : analysis.signalType === "pullback" ? 16 : 0;
  return ruleScore.passRate + signalBonus - Math.max(analysis.buyExtensionPct - 3, 0);
}
