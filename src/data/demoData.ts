import { applyResolvedGateToCandidate, parsePositionBand, resolvePositionGate } from "../domain/positionControl";
import {
  calculatePositionSizePct,
  calculateStopLossWidthPct,
  calculateTakeProfitPlan,
  evaluateStopLossRule,
  scoreSignalRules
} from "../domain/ruleEngine";
import { defaultStrategyParams } from "../domain/strategyParams";
import type {
  MarketCycleSnapshot,
  PositionStatus,
  RetailSentimentSnapshot,
  RuleResult,
  SignalCandidate,
  SignalType
} from "../domain/types";

export const marketCycleSnapshot: MarketCycleSnapshot = {
  targetDate: "2026-06-03",
  phase: "高位退潮风险",
  cycleAnchor: "一年高位区间",
  compositePositionPct: 89.9,
  shortTermState: "高位退潮风险",
  positionBand: "防守",
  suggestedPositionPct: "20%-35%",
  action: "减仓或维持低仓位",
  confidence: "中",
  missing: ["全市场上涨家数占比缺失"],
  riskTriggers: ["上涨家数占比低于35%", "跌停数重新扩散到20家以上", "炸板率升至35%以上", "放量跌破上一交易日低点或20日均线"],
  addTriggers: ["连续2-3日上涨家数修复", "跌停数维持低位", "指数放量突破一年高点且不是题材单线拉升", "中证1000和创业板相对沪深300继续扩散"],
  indices: [
    {
      key: "sh",
      name: "上证指数",
      close: 4083.97,
      oneYearPositionPct: 82.4,
      drawdownFromHighPct: -3.738,
      returns: { "5d": -0.238, "20d": -1.832, "60d": -0.599, "120d": 4.342, "250d": 20.821 }
    },
    {
      key: "cyb",
      name: "创业板指",
      close: 4122.99,
      oneYearPositionPct: 99.9,
      drawdownFromHighPct: -0.05,
      returns: { "5d": 1.909, "20d": 9.127, "60d": 28.165, "120d": 33.322, "250d": 101.557 }
    },
    {
      key: "hs300",
      name: "沪深300",
      close: 4938.81,
      oneYearPositionPct: 94.9,
      drawdownFromHighPct: -1.191,
      returns: { "5d": 0.624, "20d": 1.266, "60d": 6.264, "120d": 7.917, "250d": 26.187 }
    },
    {
      key: "zz1000",
      name: "中证1000",
      close: 8432.68,
      oneYearPositionPct: 82.4,
      drawdownFromHighPct: -5.837,
      returns: { "5d": -1.332, "20d": -1.655, "60d": 3.201, "120d": 14.161, "250d": 39.013 }
    }
  ],
  turnover: {
    totalTurnoverYi: 31302.79,
    ratios: {
      vs_5d: 1.03,
      vs_20d: 0.995,
      vs_60d: 1.216,
      vs_120d: 1.26,
      vs_250d: 1.44
    }
  },
  marketWidth: {
    limitUpCount: 66,
    limitDownCount: 11,
    failedLimitUpCount: 51,
    limitUpOpenFailureRate: 0.4359,
    highestConsecutiveLimit: 3,
    topIndustries: [
      ["电力", 7],
      ["汽车零部", 5],
      ["专用设备", 3],
      ["化学原料", 3],
      ["通信设备", 3]
    ]
  }
};

export const retailSentimentSnapshot: RetailSentimentSnapshot = {
  asOf: "2026-05-25 17:45",
  market: "A股",
  retailHeat: 55,
  regime: "正常",
  confidence: "中",
  stance: "正常配置，按原计划执行；但舆情新闻字段缺失，不升级为强仓位建议。",
  categoryScores: [
    { name: "价格成交", score: 53.7, weight: 0.25 },
    { name: "市场宽度", score: 50.2, weight: 0.25 },
    { name: "杠杆资金", score: 52.5, weight: 0.2 },
    { name: "舆情新闻", score: null, weight: 0.2 },
    { name: "题材周期", score: 75.6, weight: 0.1 }
  ],
  missingData: ["雪球/股吧/微博精确讨论量缺失", "turnover_ratio_percentile 使用代理分位字段"],
  sources: [
    {
      name: "腾讯财经指数接口",
      tier: "open",
      status: "ok",
      timestamp: "2026-05-25 16:10",
      note: "指数与成交额样本"
    },
    {
      name: "乐咕乐股赚钱效应",
      tier: "open",
      status: "ok",
      timestamp: "2026-05-25 15:00",
      note: "市场宽度和涨跌停"
    },
    {
      name: "东方财富涨跌停池",
      tier: "open",
      status: "conflict",
      timestamp: "2026-05-25 16:30",
      note: "与乐咕乐股涨跌停口径存在冲突"
    },
    {
      name: "中国结算两融汇总",
      tier: "official",
      status: "ok",
      timestamp: "2026-05-25 17:44",
      note: "T-1 两融余额"
    },
    {
      name: "雪球/股吧/微博讨论量",
      tier: "manual",
      status: "missing",
      timestamp: "2026-05-25 17:50",
      note: "缺少统一可复现样本"
    }
  ]
};

export const positionStatus: PositionStatus = (() => {
  const band = parsePositionBand(marketCycleSnapshot.suggestedPositionPct);
  const currentExposurePct = 59.3;
  const finalGate = resolvePositionGate({
    finalMin: band.min,
    finalMax: band.max,
    currentExposure: currentExposurePct
  });

  return {
    cycle: marketCycleSnapshot,
    sentiment: retailSentimentSnapshot,
    band,
    finalGate,
    currentExposurePct,
    ruleCandidates: [
      {
        ruleId: "RHI-BREAKDOWN-CAP",
        scenario: "中期破位或宽基分化时限制仓位上限",
        status: "观察假设",
        hypothesis: "中性区间内仍会发生快速下跌，破位/宽基分化应压低仓位上限。",
        confidence: "低",
        adoptionAction: "作为仓位闸门使用：低置信数据下最高不超过试探仓。",
        triggeredToday: true
      },
      {
        ruleId: "RHI-POSITION-ENTRY-ZONE",
        scenario: "低热或回撤释放且无宽度塌陷",
        status: "观察假设",
        hypothesis: "用于寻找适合分批入场的区间段。",
        confidence: "低",
        adoptionAction: "只能给60-65%试探仓上限。",
        triggeredToday: false
      },
      {
        ruleId: "RHI-WIDTH-COLLAPSE",
        scenario: "上涨家数占比低于35%且跌停数大于等于20",
        status: "观察假设",
        hypothesis: "宽度塌陷更像追涨失败风险过滤器。",
        confidence: "低",
        adoptionAction: "覆盖原始RHI等级并下调进攻仓位。",
        triggeredToday: false
      }
    ]
  };
})();

function typedRule(rule: RuleResult): RuleResult {
  return rule;
}

function buildRules(input: {
  marketPassed: boolean;
  industryRank: number;
  rsRankPct: number;
  platformDays: number;
  platformWidthPct: number;
  volumeRatio: number;
  buyExtensionPct: number;
  peTtm: number;
  entryPrice: number;
  stopPrice: number;
  signalType: SignalType;
}): RuleResult[] {
  const stopRule = evaluateStopLossRule(input.entryPrice, input.stopPrice);
  return [
    typedRule({
      id: "market.switch",
      name: "大盘开关",
      actual: input.marketPassed ? "绿灯" : "红灯",
      threshold: "绿灯",
      passed: input.marketPassed,
      severity: "hard",
      explanation: input.marketPassed ? "指数趋势允许筛选。" : "组合仓位闸门优先防守。"
    }),
    typedRule({
      id: "industry.rank",
      name: "行业强度",
      actual: `第 ${input.industryRank} 名`,
      threshold: "前 30%",
      passed: input.industryRank <= 12,
      severity: "hard",
      explanation: "用行业相对强度过滤弱势板块。"
    }),
    typedRule({
      id: "stock.rs",
      name: "个股相对强度",
      actual: input.rsRankPct,
      threshold: ">= 70",
      passed: input.rsRankPct >= 70,
      severity: "hard",
      explanation: "只保留已经强于大多数股票的标的。"
    }),
    typedRule({
      id: "pattern.platform_days",
      name: "平台天数",
      actual: input.platformDays,
      threshold: `>= ${defaultStrategyParams.pattern.minPlatformDays}`,
      passed: input.platformDays >= defaultStrategyParams.pattern.minPlatformDays,
      severity: "hard",
      explanation: "平台时间必须足够，避免把短线脉冲当作整理。"
    }),
    typedRule({
      id: "pattern.platform_width",
      name: "平台宽度",
      actual: input.platformWidthPct,
      threshold: `<= ${defaultStrategyParams.pattern.maxPlatformWidthPct}%`,
      passed: input.platformWidthPct <= defaultStrategyParams.pattern.maxPlatformWidthPct,
      severity: "hard",
      explanation: "平台波动越窄，突破后的风控越容易量化。"
    }),
    typedRule({
      id: "buy.volume",
      name: input.signalType === "pullback" ? "回踩缩量" : "突破放量",
      actual: input.volumeRatio,
      threshold: input.signalType === "pullback" ? "<= 0.85" : `>= ${defaultStrategyParams.pattern.minBreakoutVolumeRatio}`,
      passed:
        input.signalType === "pullback"
          ? input.volumeRatio <= 0.85
          : input.volumeRatio >= defaultStrategyParams.pattern.minBreakoutVolumeRatio,
      severity: "hard",
      explanation: input.signalType === "pullback" ? "回踩不应放量破坏平台。" : "突破必须有成交确认。"
    }),
    typedRule({
      id: "buy.extension",
      name: "买入偏离",
      actual: input.buyExtensionPct,
      threshold: `<= ${defaultStrategyParams.pattern.maxBuyExtensionPct}%`,
      passed: input.buyExtensionPct <= defaultStrategyParams.pattern.maxBuyExtensionPct,
      severity: "hard",
      explanation: "突破后不追离 Pivot 太远的位置。"
    }),
    typedRule({
      id: "valuation.pe",
      name: "估值过滤",
      actual: input.peTtm,
      threshold: "<= 60 或行业景气确认",
      passed: input.peTtm <= 60,
      severity: "soft",
      explanation: "估值不是单独买点，但会影响风险标签。"
    }),
    stopRule
  ];
}

function createCandidate(input: {
  id: string;
  symbol: string;
  name: string;
  industry: string;
  signalType: SignalType;
  entryPrice: number;
  lastClose: number;
  pivotPrice: number;
  stopPrice: number;
  industryRank: number;
  rsRankPct: number;
  platformDays: number;
  platformWidthPct: number;
  volumeRatio: number;
  buyExtensionPct: number;
  peTtm: number;
  tags: string[];
  sparkline: number[];
}): SignalCandidate {
  const stopLossWidthPct = calculateStopLossWidthPct(input.entryPrice, input.stopPrice);
  const riskSize = calculatePositionSizePct({
    accountRiskPct: defaultStrategyParams.stock.accountRiskPct,
    stopLossWidthPct,
    maxSinglePositionPct: defaultStrategyParams.stock.maxSinglePositionPct,
    riskMultiplier: positionStatus.finalGate.riskMultiplier
  });
  const takeProfitMain = calculateTakeProfitPlan(input.entryPrice).mainTarget;
  const rules = buildRules({
    marketPassed: positionStatus.finalGate.gate !== "blocked",
    industryRank: input.industryRank,
    rsRankPct: input.rsRankPct,
    platformDays: input.platformDays,
    platformWidthPct: input.platformWidthPct,
    volumeRatio: input.volumeRatio,
    buyExtensionPct: input.buyExtensionPct,
    peTtm: input.peTtm,
    entryPrice: input.entryPrice,
    stopPrice: input.stopPrice,
    signalType: input.signalType
  });
  const base: SignalCandidate = {
    ...input,
    signalLabel: input.signalType === "breakout" ? "平台突破" : input.signalType === "pullback" ? "突破回踩" : "候选观察",
    stopLossWidthPct,
    takeProfitMain,
    suggestedPositionPct: riskSize,
    tradability: riskSize > 0 ? "可买" : "观察",
    gate: "normal",
    gateReason: "",
    rules,
    score: scoreSignalRules({ rules })
  };

  const gated = applyResolvedGateToCandidate(base, positionStatus.finalGate);
  const hasHardFail = gated.rules.some((rule) => rule.severity === "hard" && !rule.passed && rule.id !== "market.switch");

  return {
    ...gated,
    tradability: hasHardFail ? "不可买" : gated.tradability
  };
}

export const signals: SignalCandidate[] = [
  createCandidate({
    id: "sig-600879",
    symbol: "600879",
    name: "航天电子",
    industry: "军工电子",
    signalType: "breakout",
    entryPrice: 10.42,
    lastClose: 10.36,
    pivotPrice: 10.18,
    stopPrice: 9.73,
    industryRank: 8,
    rsRankPct: 82,
    platformDays: 26,
    platformWidthPct: 7.8,
    volumeRatio: 1.86,
    buyExtensionPct: 2.4,
    peTtm: 48,
    tags: ["突破", "军工", "仓位闸门"],
    sparkline: [9.4, 9.45, 9.62, 9.58, 9.71, 9.82, 10.01, 10.18, 10.36]
  }),
  createCandidate({
    id: "sig-600941",
    symbol: "600941",
    name: "中国移动",
    industry: "通信服务",
    signalType: "pullback",
    entryPrice: 107.8,
    lastClose: 106.9,
    pivotPrice: 106.5,
    stopPrice: 101.8,
    industryRank: 6,
    rsRankPct: 76,
    platformDays: 34,
    platformWidthPct: 6.1,
    volumeRatio: 0.78,
    buyExtensionPct: 1.2,
    peTtm: 18,
    tags: ["回踩", "高股息", "低估值"],
    sparkline: [101.2, 102.7, 104.1, 106.5, 108.2, 107.4, 106.9, 107.1, 106.9]
  }),
  createCandidate({
    id: "sig-600036",
    symbol: "600036",
    name: "招商银行",
    industry: "银行",
    signalType: "watch",
    entryPrice: 42.6,
    lastClose: 42.15,
    pivotPrice: 42.2,
    stopPrice: 39.4,
    industryRank: 15,
    rsRankPct: 68,
    platformDays: 22,
    platformWidthPct: 9.2,
    volumeRatio: 1.18,
    buyExtensionPct: 1.1,
    peTtm: 7,
    tags: ["候选", "行业未进前列"],
    sparkline: [39.6, 40.1, 40.9, 41.4, 41.8, 42.2, 42.5, 42.1, 42.15]
  }),
  createCandidate({
    id: "sig-600900",
    symbol: "600900",
    name: "长江电力",
    industry: "电力",
    signalType: "breakout",
    entryPrice: 34.5,
    lastClose: 34.62,
    pivotPrice: 33.9,
    stopPrice: 31.85,
    industryRank: 3,
    rsRankPct: 73,
    platformDays: 31,
    platformWidthPct: 5.6,
    volumeRatio: 1.62,
    buyExtensionPct: 2.1,
    peTtm: 22,
    tags: ["突破", "电力", "高位防守"],
    sparkline: [31.8, 32.4, 32.9, 33.2, 33.8, 34.0, 34.2, 34.5, 34.62]
  }),
  createCandidate({
    id: "sig-688777",
    symbol: "688777",
    name: "中控技术",
    industry: "自动化设备",
    signalType: "breakout",
    entryPrice: 56.2,
    lastClose: 55.9,
    pivotPrice: 54.7,
    stopPrice: 51.1,
    industryRank: 5,
    rsRankPct: 79,
    platformDays: 19,
    platformWidthPct: 10.4,
    volumeRatio: 1.54,
    buyExtensionPct: 2.8,
    peTtm: 66,
    tags: ["突破", "估值警示"],
    sparkline: [50.4, 51.2, 52.8, 52.1, 53.4, 54.7, 55.1, 56.0, 55.9]
  }),
  createCandidate({
    id: "sig-300750",
    symbol: "300750",
    name: "宁德时代",
    industry: "电池",
    signalType: "pullback",
    entryPrice: 238.4,
    lastClose: 236.2,
    pivotPrice: 232.8,
    stopPrice: 218.6,
    industryRank: 10,
    rsRankPct: 71,
    platformDays: 17,
    platformWidthPct: 13.7,
    volumeRatio: 0.82,
    buyExtensionPct: 2.9,
    peTtm: 35,
    tags: ["回踩", "平台过宽"],
    sparkline: [220, 224, 228, 232, 240, 244, 238, 236, 236.2]
  })
];

export const dataHealth = {
  latestCycleDate: marketCycleSnapshot.targetDate,
  latestSentimentAsOf: retailSentimentSnapshot.asOf,
  mode: "现网行情失败时使用本地快照",
  liveApiReady: true,
  providers: [
    { name: "东方财富公开行情", status: "已接入", scope: "全市场快照、前复权日线" },
    { name: "AKShare", status: "已有脚本", scope: "指数、涨跌停池、情绪数据" },
    { name: "Tushare Pro", status: "预留", scope: "基础信息、估值、财务指标" },
    { name: "BaoStock", status: "预留", scope: "历史日线备份" },
    { name: "本地 RHI 快照", status: "已接入", scope: "情绪与仓位闸门" }
  ],
  warnings: [
    "当前页面候选股为演示数据，规则和闸门是真实计算。",
    "RHI 样本日期为 2026-05-25，市场周期仓位日期为 2026-06-03。",
    "当前工作区未连接 Git 仓库，远程同步需后续重试。"
  ]
};

export const overview = {
  marketSwitch: positionStatus.finalGate.gate === "blocked" ? "红灯" : "黄灯",
  signalCount: signals.length,
  tradableCount: signals.filter((signal) => signal.tradability === "可买" || signal.tradability === "半仓").length,
  watchCount: signals.filter((signal) => signal.tradability === "观察").length,
  blockedCount: signals.filter((signal) => signal.tradability === "不可买").length
};
