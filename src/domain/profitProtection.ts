export interface ProtectionPriceBar {
  high: number;
  low: number;
  close: number;
}

export type ProfitProtectionStage = "initial" | "breakeven" | "protect30" | "protect45" | "protect60";

export interface ProfitProtectionInput {
  entryPrice: number;
  initialStopPrice: number;
  currentStopPrice?: number;
  highestPrice: number;
  atr?: number;
  atrMultiple?: number;
}

export interface ProfitProtectionResult {
  effectiveStopPrice: number;
  highestPrice: number;
  profitStopPrice?: number;
  atrStopPrice?: number;
  rMultiple: number;
  protectedProfitPct: number;
  stage: ProfitProtectionStage;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function numberValue(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function trueRange(current: ProtectionPriceBar, previous?: ProtectionPriceBar): number {
  if (!previous) return Math.max(0, current.high - current.low);
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - previous.close),
    Math.abs(current.low - previous.close)
  );
}

export function calculateAtr(bars: ProtectionPriceBar[], period = 22): number {
  const validBars = bars.filter((bar) => bar.high > 0 && bar.low > 0 && bar.close > 0);
  if (validBars.length === 0) return 0;
  const window = validBars.slice(-Math.max(1, Math.floor(period)));
  const ranges = window.map((bar, index) => trueRange(bar, validBars[validBars.length - window.length + index - 1]));
  return round(ranges.reduce((sum, value) => sum + value, 0) / ranges.length);
}

function stageForRMultiple(rMultiple: number): {
  stage: ProfitProtectionStage;
  protectionRatio: number | null;
} {
  if (rMultiple < 1.5) return { stage: "initial", protectionRatio: null };
  if (rMultiple < 2.5) return { stage: "breakeven", protectionRatio: 0 };
  if (rMultiple < 4) return { stage: "protect30", protectionRatio: 0.3 };
  if (rMultiple < 6) return { stage: "protect45", protectionRatio: 0.45 };
  return { stage: "protect60", protectionRatio: 0.6 };
}

export function calculateProfitProtectionStop(input: ProfitProtectionInput): ProfitProtectionResult {
  const entryPrice = numberValue(input.entryPrice);
  const initialStopPrice = numberValue(input.initialStopPrice);
  const currentStopPrice = numberValue(input.currentStopPrice) || initialStopPrice;
  const highestPrice = Math.max(entryPrice, numberValue(input.highestPrice));
  const initialRisk = entryPrice - initialStopPrice;

  if (entryPrice <= 0 || initialStopPrice <= 0 || initialRisk <= 0) {
    return {
      effectiveStopPrice: round(Math.max(currentStopPrice, initialStopPrice)),
      highestPrice: round(highestPrice),
      rMultiple: 0,
      protectedProfitPct: 0,
      stage: "initial"
    };
  }

  const maxProfit = Math.max(0, highestPrice - entryPrice);
  const rMultiple = maxProfit / initialRisk;
  const stage = stageForRMultiple(rMultiple);
  const candidates = [initialStopPrice, currentStopPrice];
  let profitStopPrice: number | undefined;
  let atrStopPrice: number | undefined;

  if (stage.protectionRatio !== null) {
    profitStopPrice = stage.protectionRatio === 0 ? entryPrice : entryPrice + maxProfit * stage.protectionRatio;
    candidates.push(profitStopPrice);
    const atr = numberValue(input.atr);
    if (atr > 0) {
      atrStopPrice = highestPrice - atr * (input.atrMultiple ?? 3);
      candidates.push(atrStopPrice);
    }
  }

  const effectiveStopPrice = Math.max(...candidates.filter((value) => Number.isFinite(value) && value > 0));
  const protectedProfitPct = entryPrice > 0 ? ((effectiveStopPrice / entryPrice) - 1) * 100 : 0;

  return {
    effectiveStopPrice: round(effectiveStopPrice),
    highestPrice: round(highestPrice),
    profitStopPrice: profitStopPrice === undefined ? undefined : round(profitStopPrice),
    atrStopPrice: atrStopPrice === undefined ? undefined : round(atrStopPrice),
    rMultiple: round(rMultiple),
    protectedProfitPct: round(protectedProfitPct),
    stage: stage.stage
  };
}
