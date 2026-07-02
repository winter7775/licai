import type { DailyBar } from "../live/marketScreener";

export interface TradeExecutionCostConfig {
  commissionPct?: number;
  transferFeePct?: number;
  stampDutyPct?: number;
  slippagePct?: number;
  blockLimitOpenBuys?: boolean;
  blockLimitDownStops?: boolean;
}

export interface TradeFill {
  price: number;
  rawPrice: number;
  slippageAmount: number;
  fees: number;
  grossAmount: number;
  netCashAmount: number;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function pctValue(value: number | undefined): number {
  return Math.max(0, value ?? 0) / 100;
}

function limitPctForSymbol(symbol: string): number {
  return symbol.startsWith("300") || symbol.startsWith("301") || symbol.startsWith("688") ? 20 : 10;
}

export function previousCloseFromBars(current: DailyBar, previous?: DailyBar): number {
  if (previous?.close && previous.close > 0) return previous.close;
  const fromChange = current.close - current.changeAmount;
  return fromChange > 0 ? fromChange : current.open;
}

export function isLimitUpOpen(symbol: string, current: DailyBar, previous?: DailyBar): boolean {
  const previousClose = previousCloseFromBars(current, previous);
  const limitPrice = previousClose * (1 + limitPctForSymbol(symbol) / 100);
  return current.open >= limitPrice * 0.999 && current.high <= current.open * 1.001;
}

export function isLimitDownLocked(symbol: string, current: DailyBar, previous?: DailyBar): boolean {
  const previousClose = previousCloseFromBars(current, previous);
  const limitPrice = previousClose * (1 - limitPctForSymbol(symbol) / 100);
  return current.open <= limitPrice * 1.001 && current.low >= current.open * 0.999 && current.high <= current.open * 1.001;
}

export function canBuyAtOpen(symbol: string, current: DailyBar, previous: DailyBar | undefined, config: TradeExecutionCostConfig): boolean {
  if (current.open <= 0 || current.volume <= 0 || current.amount <= 0) return false;
  return !(config.blockLimitOpenBuys ?? true) || !isLimitUpOpen(symbol, current, previous);
}

export function executionPrice(side: "buy" | "sell", rawPrice: number, config: TradeExecutionCostConfig): number {
  const slippage = pctValue(config.slippagePct);
  return round(side === "buy" ? rawPrice * (1 + slippage) : rawPrice * (1 - slippage));
}

export function estimateFees(side: "buy" | "sell", grossAmount: number, config: TradeExecutionCostConfig): number {
  const commission = grossAmount * pctValue(config.commissionPct);
  const transfer = grossAmount * pctValue(config.transferFeePct);
  const stamp = side === "sell" ? grossAmount * pctValue(config.stampDutyPct) : 0;
  return round(commission + transfer + stamp);
}

export function buildTradeFill(side: "buy" | "sell", rawPrice: number, quantity: number, config: TradeExecutionCostConfig): TradeFill {
  const price = executionPrice(side, rawPrice, config);
  const grossAmount = round(quantity * price);
  const fees = estimateFees(side, grossAmount, config);
  const netCashAmount = side === "buy" ? round(grossAmount + fees) : round(grossAmount - fees);
  return {
    price,
    rawPrice: round(rawPrice),
    slippageAmount: round(Math.abs(price - rawPrice) * quantity),
    fees,
    grossAmount,
    netCashAmount
  };
}
