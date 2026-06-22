import type { PositionStatus, RuleResult, SignalType } from "./types";

export type PaperTradeSide = "buy" | "sell";

export interface PaperHolding {
  symbol: string;
  name: string;
  industry: string;
  quantity: number;
  avgCost: number;
  stopPrice: number;
  takeProfitPrice: number;
  openedAt: string;
  updatedAt: string;
  reason: string;
}

export interface PaperTradeInput {
  side: PaperTradeSide;
  symbol: string;
  name: string;
  industry?: string;
  quantity: number;
  price: number;
  stopPrice?: number;
  takeProfitPrice?: number;
  reason: string;
  tradedAt: string;
}

export interface PaperTrade extends PaperTradeInput {
  id: string;
  amount: number;
}

export interface PaperDailyReview {
  id: string;
  date: string;
  actionSummary: string;
  marketGate: string;
  targetExposurePct: number;
  decisions: string[];
  createdAt: string;
}

export interface PaperAccount {
  initialCapital: number;
  cash: number;
  holdings: PaperHolding[];
  trades: PaperTrade[];
  reviews: PaperDailyReview[];
  updatedAt: string;
}

export interface PaperHoldingSummary extends PaperHolding {
  currentPrice: number;
  marketValue: number;
  costValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  weightPct: number;
}

export interface PaperAccountSummary {
  initialCapital: number;
  cash: number;
  marketValue: number;
  totalAssets: number;
  totalReturn: number;
  totalReturnPct: number;
  exposurePct: number;
  holdings: PaperHoldingSummary[];
}

export interface PaperCandidate {
  symbol: string;
  name: string;
  industry: string;
  price: number;
  signalType: SignalType;
  score: number;
  stopPrice: number;
  takeProfitPrice: number;
  suggestedPositionPct: number;
  hardRulesPassed: boolean;
  rules?: RuleResult[];
  reason: string;
}

export interface PaperTradingPlanInput {
  account: PaperAccount;
  candidates: PaperCandidate[];
  position: PositionStatus;
  tradedAt: string;
}

export interface PaperTradingPlanResult {
  account: PaperAccount;
  trades: PaperTrade[];
  review: PaperDailyReview;
}

const INITIAL_CAPITAL = 200_000;
const MAX_SINGLE_POSITION_PCT = 10;
const MAX_TRIAL_SINGLE_POSITION_PCT = 3;
const MAX_TRIAL_TOTAL_POSITION_PCT = 10;
const MIN_BUY_AMOUNT = 5_000;

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function normalizedSymbol(symbol: string): string {
  return symbol.trim().padStart(6, "0").slice(-6);
}

function tradeId(trade: PaperTradeInput, sequence: number): string {
  return `${trade.tradedAt.slice(0, 10)}-${trade.side}-${normalizedSymbol(trade.symbol)}-${sequence}`;
}

function reviewId(createdAt: string): string {
  return `review-${createdAt.slice(0, 10)}`;
}

export function createInitialPaperAccount(now = new Date().toISOString()): PaperAccount {
  return {
    initialCapital: INITIAL_CAPITAL,
    cash: INITIAL_CAPITAL,
    holdings: [],
    trades: [],
    reviews: [],
    updatedAt: now
  };
}

export function summarizePaperAccount(account: PaperAccount, quotes: Record<string, number> = {}): PaperAccountSummary {
  const holdings = account.holdings.map((holding) => {
    const currentPrice = quotes[holding.symbol] && quotes[holding.symbol] > 0 ? quotes[holding.symbol] : holding.avgCost;
    const marketValue = holding.quantity * currentPrice;
    const costValue = holding.quantity * holding.avgCost;
    const unrealizedPnl = marketValue - costValue;

    return {
      ...holding,
      currentPrice: round(currentPrice),
      marketValue: round(marketValue),
      costValue: round(costValue),
      unrealizedPnl: round(unrealizedPnl),
      unrealizedPnlPct: costValue > 0 ? round((unrealizedPnl / costValue) * 100) : 0,
      weightPct: 0
    };
  });
  const marketValue = round(holdings.reduce((sum, holding) => sum + holding.marketValue, 0));
  const totalAssets = round(account.cash + marketValue);
  const enriched = holdings.map((holding) => ({
    ...holding,
    weightPct: totalAssets > 0 ? round((holding.marketValue / totalAssets) * 100) : 0
  }));

  return {
    initialCapital: account.initialCapital,
    cash: round(account.cash),
    marketValue,
    totalAssets,
    totalReturn: round(totalAssets - account.initialCapital),
    totalReturnPct: account.initialCapital > 0 ? round(((totalAssets - account.initialCapital) / account.initialCapital) * 100) : 0,
    exposurePct: totalAssets > 0 ? round((marketValue / totalAssets) * 100) : 0,
    holdings: enriched
  };
}

export function applyPaperTrade(account: PaperAccount, input: PaperTradeInput): PaperAccount {
  const symbol = normalizedSymbol(input.symbol);
  const quantity = Math.max(Math.floor(Number(input.quantity) || 0), 0);
  const price = Number(input.price) || 0;
  if (quantity <= 0 || price <= 0) return account;

  const amount = round(quantity * price);
  const trade: PaperTrade = {
    ...input,
    id: tradeId({ ...input, symbol }, account.trades.length + 1),
    symbol,
    quantity,
    price: round(price),
    amount
  };
  const existing = account.holdings.find((holding) => holding.symbol === symbol);
  const others = account.holdings.filter((holding) => holding.symbol !== symbol);

  if (input.side === "buy") {
    const spend = Math.min(amount, account.cash);
    if (spend < amount) return account;
    const nextHolding: PaperHolding = existing
      ? {
          ...existing,
          quantity: existing.quantity + quantity,
          avgCost: round((existing.avgCost * existing.quantity + amount) / (existing.quantity + quantity)),
          stopPrice: input.stopPrice ?? existing.stopPrice,
          takeProfitPrice: input.takeProfitPrice ?? existing.takeProfitPrice,
          updatedAt: input.tradedAt,
          reason: input.reason
        }
      : {
          symbol,
          name: input.name,
          industry: input.industry ?? "未分类",
          quantity,
          avgCost: round(price),
          stopPrice: input.stopPrice ?? round(price * 0.93),
          takeProfitPrice: input.takeProfitPrice ?? round(price * 1.4),
          openedAt: input.tradedAt,
          updatedAt: input.tradedAt,
          reason: input.reason
        };

    return {
      ...account,
      cash: round(account.cash - amount),
      holdings: [...others, nextHolding].sort((left, right) => left.symbol.localeCompare(right.symbol)),
      trades: [...account.trades, trade],
      updatedAt: input.tradedAt
    };
  }

  if (!existing) return account;
  const soldQuantity = Math.min(quantity, existing.quantity);
  const sellAmount = round(soldQuantity * price);
  const remainingQuantity = existing.quantity - soldQuantity;
  const nextHoldings =
    remainingQuantity > 0
      ? [
          ...others,
          {
            ...existing,
            quantity: remainingQuantity,
            updatedAt: input.tradedAt,
            reason: input.reason
          }
        ].sort((left, right) => left.symbol.localeCompare(right.symbol))
      : others;

  return {
    ...account,
    cash: round(account.cash + sellAmount),
    holdings: nextHoldings,
    trades: [
      ...account.trades,
      {
        ...trade,
        quantity: soldQuantity,
        amount: sellAmount
      }
    ],
    updatedAt: input.tradedAt
  };
}

function paperTargetBand(position: PositionStatus): { min: number; max: number } {
  const min = Math.max(0, Number(position.band.min) || 0);
  const max = Math.max(min, Number(position.band.max) || 0);
  return { min, max };
}

function paperEntryBlockReason(position: PositionStatus, summary: PaperAccountSummary): string | null {
  const band = paperTargetBand(position);
  if (band.max <= 0) {
    return `${position.finalGate.label}：未开新仓，${position.finalGate.reason}`;
  }
  if (summary.exposurePct >= band.max) {
    return `模拟盘仓位 ${summary.exposurePct.toFixed(1)}% 已达到市场建议区间 ${band.min.toFixed(1)}%-${band.max.toFixed(1)}%，未开新仓。`;
  }
  return null;
}

function isQualifiedCandidate(candidate: PaperCandidate): boolean {
  return candidate.signalType !== "watch" && candidate.hardRulesPassed && candidate.price > 0;
}

function rulePassed(candidate: PaperCandidate, id: string): boolean {
  return candidate.rules?.find((rule) => rule.id === id)?.passed === true;
}

function platformQualityPassCount(candidate: PaperCandidate): number {
  return ["base.volume_contraction", "base.atr_contraction", "base.volatility_contraction"].filter((id) => rulePassed(candidate, id)).length;
}

function parseBreakoutActual(candidate: PaperCandidate): { extensionPct: number | null; volumeRatio: number | null } {
  const actual = String(candidate.rules?.find((rule) => rule.id === "buy.breakout")?.actual ?? "");
  const numbers = Array.from(actual.matchAll(/-?\d+(?:\.\d+)?/g)).map((match) => Number(match[0])).filter((value) => Number.isFinite(value));
  return {
    extensionPct: numbers[0] ?? null,
    volumeRatio: numbers[1] ?? null
  };
}

function isTrialCandidate(candidate: PaperCandidate): boolean {
  if (isQualifiedCandidate(candidate)) return false;
  if (!candidate.hardRulesPassed || candidate.price <= 0 || !candidate.rules?.length) return false;
  if (!rulePassed(candidate, "trend.template")) return false;
  if (!rulePassed(candidate, "risk.stop_loss_width")) return false;

  const platformReady = rulePassed(candidate, "base.range") && platformQualityPassCount(candidate) >= 2;
  const breakout = parseBreakoutActual(candidate);
  const nearBreakout =
    breakout.extensionPct !== null &&
    breakout.volumeRatio !== null &&
    breakout.extensionPct >= -3 &&
    breakout.extensionPct <= 3 &&
    breakout.volumeRatio >= 0.9;

  return platformReady && nearBreakout;
}

function trialExposureAmount(summary: PaperAccountSummary): number {
  return summary.holdings
    .filter((holding) => holding.reason.includes("B"))
    .reduce((sum, holding) => sum + holding.marketValue, 0);
}

function candidateGrade(candidate: PaperCandidate): "A" | "B" | null {
  if (isQualifiedCandidate(candidate)) return "A";
  if (isTrialCandidate(candidate)) return "B";
  return null;
}

function gradeRank(grade: "A" | "B"): number {
  return grade === "A" ? 0 : 1;
}

function actionSummary(trades: PaperTrade[], blockedNewEntries: boolean): string {
  const buys = trades.filter((trade) => trade.side === "buy").length;
  const sells = trades.filter((trade) => trade.side === "sell").length;
  if (blockedNewEntries && buys === 0) return sells > 0 ? `卖出 ${sells} 笔，未开新仓` : "未开新仓";
  if (buys === 0 && sells === 0) return "无新增交易";
  return [`买入 ${buys} 笔`, `卖出 ${sells} 笔`].filter((part) => !part.includes(" 0 ")).join("，");
}

export function generatePaperTradingPlan(input: PaperTradingPlanInput): PaperTradingPlanResult {
  let nextAccount = input.account;
  const trades: PaperTrade[] = [];
  const decisions: string[] = [];
  const quotes = Object.fromEntries(input.candidates.map((candidate) => [normalizedSymbol(candidate.symbol), candidate.price]));
  const exitedSymbols = new Set<string>();

  for (const holding of input.account.holdings) {
    const currentPrice = quotes[holding.symbol] ?? holding.avgCost;
    if (currentPrice <= holding.stopPrice || currentPrice >= holding.takeProfitPrice) {
      const reason = currentPrice <= holding.stopPrice ? `触发止损 ${holding.stopPrice}` : `触发止盈 ${holding.takeProfitPrice}`;
      const beforeCount = nextAccount.trades.length;
      nextAccount = applyPaperTrade(nextAccount, {
        side: "sell",
        symbol: holding.symbol,
        name: holding.name,
        industry: holding.industry,
        quantity: holding.quantity,
        price: currentPrice,
        reason,
        tradedAt: input.tradedAt
      });
      trades.push(...nextAccount.trades.slice(beforeCount));
      exitedSymbols.add(holding.symbol);
      decisions.push(`${holding.symbol} ${reason}`);
    }
  }

  const summary = summarizePaperAccount(nextAccount, quotes);
  const targetBand = paperTargetBand(input.position);
  const entryBlockReason = paperEntryBlockReason(input.position, summary);
  const blockedNewEntries = entryBlockReason !== null;
  if (blockedNewEntries) {
    decisions.push(entryBlockReason);
  } else {
    let remainingExposureAmount = Math.max(0, (summary.totalAssets * targetBand.max) / 100 - summary.marketValue);
    let remainingTrialAmount = Math.max(0, (summary.totalAssets * MAX_TRIAL_TOTAL_POSITION_PCT) / 100 - trialExposureAmount(summary));
    const existingSymbols = new Set(nextAccount.holdings.map((holding) => holding.symbol));
    const sortedCandidates = input.candidates
      .map((candidate) => ({ candidate, grade: candidateGrade(candidate) }))
      .filter((item): item is { candidate: PaperCandidate; grade: "A" | "B" } => item.grade !== null)
      .filter((item) => !existingSymbols.has(normalizedSymbol(item.candidate.symbol)))
      .filter((item) => !exitedSymbols.has(normalizedSymbol(item.candidate.symbol)))
      .sort((left, right) => gradeRank(left.grade) - gradeRank(right.grade) || right.candidate.score - left.candidate.score);

    for (const { candidate: item, grade } of sortedCandidates) {
      if (remainingExposureAmount < MIN_BUY_AMOUNT) break;
      if (grade === "B" && remainingTrialAmount < MIN_BUY_AMOUNT) continue;

      const targetPct =
        grade === "B"
          ? Math.min(MAX_TRIAL_SINGLE_POSITION_PCT, targetBand.max)
          : Math.min(item.suggestedPositionPct, MAX_SINGLE_POSITION_PCT, targetBand.max);
      const targetAmount = Math.min(
        (summary.totalAssets * targetPct) / 100,
        remainingExposureAmount,
        grade === "B" ? remainingTrialAmount : Number.POSITIVE_INFINITY,
        nextAccount.cash
      );
      if (targetAmount < MIN_BUY_AMOUNT) {
        decisions.push(`${item.symbol} 计划金额低于最小买入额，跳过`);
        continue;
      }
      const quantity = Math.floor(targetAmount / item.price / 100) * 100;
      if (quantity <= 0) continue;

      const reason = grade === "B" ? `B级试错：${item.reason}` : item.reason;
      const beforeCount = nextAccount.trades.length;
      nextAccount = applyPaperTrade(nextAccount, {
        side: "buy",
        symbol: item.symbol,
        name: item.name,
        industry: item.industry,
        quantity,
        price: item.price,
        stopPrice: item.stopPrice,
        takeProfitPrice: item.takeProfitPrice,
        reason,
        tradedAt: input.tradedAt
      });
      const newTrades = nextAccount.trades.slice(beforeCount);
      trades.push(...newTrades);
      remainingExposureAmount = Math.max(0, remainingExposureAmount - newTrades.reduce((sum, trade) => sum + trade.amount, 0));
      if (grade === "B") {
        remainingTrialAmount = Math.max(0, remainingTrialAmount - newTrades.reduce((sum, trade) => sum + trade.amount, 0));
        decisions.push(`${item.symbol} ${item.name} B级试错，模拟买入 ${quantity} 股`);
        continue;
      }
      decisions.push(`${item.symbol} ${item.name} 符合规则，模拟买入 ${quantity} 股`);
    }

    const paperTargetDecision = `模拟盘按自身仓位执行：市场建议区间 ${targetBand.min.toFixed(1)}%-${targetBand.max.toFixed(1)}%，当前仓位 ${summary.exposurePct.toFixed(1)}%，允许按规则寻找标的。`;
    if (trades.some((trade) => trade.side === "buy")) {
      decisions.unshift(
        `${paperTargetDecision}本轮补仓后不超过上限。`
      );
    } else {
      decisions.unshift(paperTargetDecision);
      decisions.push("本轮没有符合硬性交易规则的标的，未强行建仓。");
    }
  }

  const review: PaperDailyReview = {
    id: reviewId(input.tradedAt),
    date: input.tradedAt.slice(0, 10),
    actionSummary: actionSummary(trades, blockedNewEntries),
    marketGate: input.position.finalGate.label,
    targetExposurePct: targetBand.max,
    decisions: decisions.length > 0 ? decisions : ["全 A 股深度筛选后未出现满足开仓条件的标的"],
    createdAt: input.tradedAt
  };

  return {
    account: {
      ...nextAccount,
      updatedAt: input.tradedAt,
      reviews: [review, ...nextAccount.reviews.filter((item) => item.id !== review.id)]
    },
    trades,
    review
  };
}
