export type PositionGate = "normal" | "half" | "watch_only" | "blocked";

export type Tradability = "可买" | "半仓" | "观察" | "不可买";

export type SignalType = "breakout" | "pullback" | "watch";

export type RuleSeverity = "hard" | "soft" | "info";

export interface RuleResult {
  id: string;
  name: string;
  actual: string | number;
  threshold: string | number;
  passed: boolean;
  severity?: RuleSeverity;
  explanation?: string;
}

export interface RuleScore {
  passedCount: number;
  totalCount: number;
  passRate: number;
}

export interface SignalCandidate {
  id: string;
  symbol: string;
  name: string;
  industry: string;
  signalType: SignalType;
  signalLabel: string;
  entryPrice: number;
  lastClose: number;
  pivotPrice: number;
  stopPrice: number;
  stopLossWidthPct: number;
  takeProfitMain: number;
  suggestedPositionPct: number;
  tradability: Tradability;
  gate: PositionGate;
  gateReason: string;
  rules: RuleResult[];
  tags: string[];
  sparkline: number[];
  score: RuleScore;
}

export interface PositionBand {
  min: number;
  max: number;
}

export interface PositionGateResult extends PositionBand {
  gate: PositionGate;
  label: string;
  reason: string;
  riskMultiplier: number;
}

export interface MarketIndexPosition {
  key: string;
  name: string;
  close: number;
  oneYearPositionPct: number;
  drawdownFromHighPct: number;
  returns: {
    "5d": number | null;
    "20d": number | null;
    "60d": number | null;
    "120d": number | null;
    "250d": number | null;
  };
}

export interface MarketCycleSnapshot {
  targetDate: string;
  phase: string;
  cycleAnchor: string;
  compositePositionPct: number;
  shortTermState: string;
  positionBand: string;
  suggestedPositionPct: string;
  action: string;
  confidence: string;
  riskTriggers: string[];
  addTriggers: string[];
  missing: string[];
  indices: MarketIndexPosition[];
  turnover: {
    totalTurnoverYi: number;
    ratios: Record<string, number>;
  };
  marketWidth: {
    limitUpCount: number;
    limitDownCount: number;
    failedLimitUpCount: number;
    limitUpOpenFailureRate: number;
    highestConsecutiveLimit: number;
    topIndustries: Array<[string, number]>;
  };
}

export interface RetailSentimentSnapshot {
  asOf: string;
  market: string;
  retailHeat: number;
  regime: string;
  confidence: string;
  stance: string;
  categoryScores: Array<{
    name: string;
    score: number | null;
    weight: number;
  }>;
  missingData: string[];
  sources: Array<{
    name: string;
    tier: string;
    status: "ok" | "conflict" | "missing" | "manual";
    timestamp: string;
    note: string;
  }>;
}

export interface PositionStatus {
  cycle: MarketCycleSnapshot;
  sentiment: RetailSentimentSnapshot;
  band: PositionBand;
  finalGate: PositionGateResult;
  currentExposurePct: number;
  ruleCandidates: Array<{
    ruleId: string;
    scenario: string;
    status: string;
    hypothesis: string;
    confidence: string;
    adoptionAction: string;
    triggeredToday: boolean;
  }>;
}

export interface StrategyParams {
  version: string;
  market: {
    minIndexScore: number;
    redLightBlocksNewEntries: boolean;
  };
  stock: {
    maxStopLossPct: number;
    mainTakeProfitPct: number;
    maxSinglePositionPct: number;
    maxIndustryPositionPct: number;
    maxHoldings: number;
    accountRiskPct: number;
  };
  pattern: {
    minPlatformDays: number;
    maxPlatformWidthPct: number;
    minBreakoutVolumeRatio: number;
    maxBuyExtensionPct: number;
  };
}
