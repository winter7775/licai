import type { RetailSentimentSnapshot } from "./types";

export interface CycleSentimentInput {
  targetDate: string;
  turnoverVs20d?: number | null;
  turnoverPercentile?: number | null;
  advancersRatio?: number | null;
  limitUpCount?: number | null;
  limitDownCount?: number | null;
  highestConsecutiveLimit?: number | null;
  limitUpOpenFailureRate?: number | null;
  marginBalanceChangePct?: number | null;
  marginBuyRatioPercentile?: number | null;
  socialDiscussionPercentile?: number | null;
  newsHeatPercentile?: number | null;
  topIndustries?: Array<[string, number]>;
  grossExposure?: number;
  hotTopicExposure?: number;
  singleNameMax?: number;
}

const CATEGORY_WEIGHTS: Record<string, number> = {
  价格成交: 0.25,
  市场宽度: 0.25,
  杠杆资金: 0.2,
  舆情新闻: 0.2,
  题材周期: 0.1
};

function clamp(value: number, lower = 0, upper = 100): number {
  return Math.max(lower, Math.min(upper, value));
}

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function mean(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function scoreTurnoverVs20d(value?: number | null): number | null {
  if (value === null || value === undefined) return null;
  return clamp((value / 2) * 100);
}

function weightedHeat(scores: Record<string, number | null>): number {
  const available = Object.entries(scores).filter((entry): entry is [string, number] => entry[1] !== null);
  if (available.length === 0) return 50;
  const weightSum = available.reduce((sum, [key]) => sum + CATEGORY_WEIGHTS[key], 0);
  return round(available.reduce((sum, [key, score]) => sum + CATEGORY_WEIGHTS[key] * score, 0) / weightSum);
}

function classifyRegime(heat: number): string {
  if (heat < 20) return "极冷";
  if (heat < 40) return "偏冷";
  if (heat < 60) return "正常";
  if (heat < 70) return "偏热分化";
  if (heat < 85) return "过热";
  if (heat < 95) return "极热";
  return "狂热高危";
}

function baseStance(regime: string): string {
  const stances: Record<string, string> = {
    极冷: "观望为主，允许小仓试探低热改善方向",
    偏冷: "轻仓试探，等待价格止跌和基本面确认",
    正常: "正常配置，按原计划执行",
    偏热分化: "不追高，观察分化是否扩散，已有高热题材仓收紧止盈",
    过热: "不追高，收紧止盈，已有高热仓位分批降风险",
    极热: "分批降仓，停止新开高热题材仓位",
    狂热高危: "防守优先，停止追高和新开高热仓位，重点检查退潮信号"
  };
  return stances[regime] ?? stances["正常"];
}

export function buildRetailSentimentFromCycle(input: CycleSentimentInput): RetailSentimentSnapshot {
  const priceVolumeScore = mean([input.turnoverPercentile ?? null, scoreTurnoverVs20d(input.turnoverVs20d), null]);
  const breadthScore = mean([
    input.advancersRatio === null || input.advancersRatio === undefined ? null : clamp(input.advancersRatio * 100),
    input.limitUpCount === null || input.limitUpCount === undefined ? null : clamp((input.limitUpCount / 120) * 100),
    input.highestConsecutiveLimit === null || input.highestConsecutiveLimit === undefined
      ? null
      : clamp((input.highestConsecutiveLimit / 10) * 100),
    input.limitUpOpenFailureRate === null || input.limitUpOpenFailureRate === undefined
      ? null
      : clamp(input.limitUpOpenFailureRate * 100)
  ]);
  const leverageScore = mean([
    input.marginBalanceChangePct === null || input.marginBalanceChangePct === undefined
      ? null
      : clamp(((input.marginBalanceChangePct + 2) / 4) * 100),
    input.marginBuyRatioPercentile ?? null
  ]);
  const socialNewsScore = mean([input.socialDiscussionPercentile ?? null, input.newsHeatPercentile ?? null]);
  const topicScore = mean(
    (input.topIndustries ?? []).slice(0, 5).map(([, count]) => clamp(45 + Math.min(count, 12) * 3))
  );
  const categoryScores: Record<string, number | null> = {
    价格成交: priceVolumeScore === null ? null : round(priceVolumeScore),
    市场宽度: breadthScore === null ? null : round(breadthScore),
    杠杆资金: leverageScore === null ? null : round(leverageScore),
    舆情新闻: socialNewsScore === null ? null : round(socialNewsScore),
    题材周期: topicScore === null ? null : round(topicScore)
  };
  const retailHeat = weightedHeat(categoryScores);
  const regime = classifyRegime(retailHeat);
  const missingData: string[] = [];

  if (priceVolumeScore === null) missingData.push("价格成交：成交额、换手或新高比例缺失");
  if (breadthScore === null) missingData.push("市场宽度：涨跌家数、涨停跌停、连板或炸板数据缺失");
  if (leverageScore === null) missingData.push("杠杆资金：融资余额变化和融资买入分位缺失");
  if (socialNewsScore === null) missingData.push("舆情新闻：社交讨论热度和新闻热度缺失");
  if (topicScore === null) missingData.push("题材周期：热点题材列表和阶段判断缺失");

  const confidence =
    Object.values(categoryScores).filter((score) => score !== null).length < 3 || missingData.length >= 3
      ? "低"
      : missingData.length > 0
        ? "中"
        : "高";
  const stance = confidence === "低" ? `观察为主，${baseStance(regime)}；但数据不足，不输出强仓位建议` : baseStance(regime);

  return {
    asOf: `${input.targetDate} 收盘`,
    market: "A股",
    retailHeat,
    regime,
    confidence,
    stance,
    categoryScores: Object.entries(categoryScores).map(([name, score]) => ({
      name,
      score,
      weight: CATEGORY_WEIGHTS[name]
    })),
    missingData,
    sources: [
      {
        name: "市场周期自动刷新",
        tier: "local",
        status: "ok",
        timestamp: `${input.targetDate} 收盘`,
        note: "复用 market_cycle_position 输出的成交、宽度、涨跌停池与两融代理指标"
      },
      {
        name: "社交/新闻精确热度",
        tier: "manual",
        status: socialNewsScore === null ? "missing" : "ok",
        timestamp: `${input.targetDate} 收盘`,
        note: socialNewsScore === null ? "暂未接入稳定可复现源" : "由外部字段输入"
      }
    ]
  };
}
