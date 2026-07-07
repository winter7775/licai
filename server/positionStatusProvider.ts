import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildRetailSentimentFromCycle } from "../src/domain/sentimentScoring";
import { parsePositionBand, resolvePositionGate } from "../src/domain/positionControl";
import type { MarketCycleSnapshot, PositionStatus } from "../src/domain/types";
import { resolveMarketCycleWorkspace } from "./marketCycleWorkspace";
import { resolvePythonExecutable } from "./pythonRuntime";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SERVER_DIR, "..");
const MARKET_CYCLE_WORKSPACE = resolveMarketCycleWorkspace({ appDir: APP_DIR });
const ROOT_DIR = MARKET_CYCLE_WORKSPACE.rootDir;
const SIGNALS_DIR = MARKET_CYCLE_WORKSPACE.signalsDir;
const MARKET_CYCLE_SCRIPT = MARKET_CYCLE_WORKSPACE.scriptPath;
const PYTHON_EXE = resolvePythonExecutable({ rootDir: ROOT_DIR });

export interface PortfolioExposureSummary {
  exposurePct: number;
  singleNameMaxPct: number;
}

export interface PositionStatusResponse {
  status: PositionStatus;
  source: {
    mode: "refreshed" | "cached";
    file: string;
    refreshedAt: string;
    warnings: string[];
  };
}

type RawCyclePosition = Record<string, any>;

function shanghaiDateString(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}

export function fallbackCyclePosition(now = new Date()): RawCyclePosition {
  const targetDate = shanghaiDateString(now);
  return {
    metrics: {
      target_date: targetDate,
      indices: {
        sh: { close: 0, one_year_position_pct: 75, drawdown_from_high_pct: 0, returns: {} },
        cyb: { close: 0, one_year_position_pct: 75, drawdown_from_high_pct: 0, returns: {} },
        hs300: { close: 0, one_year_position_pct: 75, drawdown_from_high_pct: 0, returns: {} },
        zz1000: { close: 0, one_year_position_pct: 75, drawdown_from_high_pct: 0, returns: {} }
      },
      turnover: { total_turnover_yi: 0, ratios: {} },
      market_width: {
        limit_up_count: 0,
        limit_down_count: 0,
        failed_limit_up_count: 0,
        limit_up_open_failure_rate: 0.35,
        highest_consecutive_limit: 0,
        top_industries: []
      },
      margin_change_pct: 0
    },
    classification: {
      phase: "云端保守兜底",
      cycle_anchor: "市场情绪刷新失败",
      composite_position_pct: 75,
      short_term_state: "云端保守兜底",
      position_band: "防守",
      suggested_position_pct: "20%-35%",
      action: "仅允许模拟盘小仓位试错",
      confidence: "低",
      risk_triggers: ["云端未取得本地RHI/市场周期文件"],
      add_triggers: [],
      missing: ["market_cycle_position 数据缺失"]
    }
  };
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function returnsValue(returns: Record<string, unknown> | undefined, key: string): number | null {
  const value = returns?.[key];
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapIndex(key: string, raw: Record<string, any>) {
  const names: Record<string, string> = {
    sh: "上证指数",
    cyb: "创业板指",
    hs300: "沪深300",
    zz1000: "中证1000"
  };

  return {
    key,
    name: names[key] ?? key,
    close: numberValue(raw.close),
    oneYearPositionPct: numberValue(raw.one_year_position_pct),
    drawdownFromHighPct: numberValue(raw.drawdown_from_high_pct),
    returns: {
      "5d": returnsValue(raw.returns, "5d"),
      "20d": returnsValue(raw.returns, "20d"),
      "60d": returnsValue(raw.returns, "60d"),
      "120d": returnsValue(raw.returns, "120d"),
      "250d": returnsValue(raw.returns, "250d")
    }
  };
}

function mapCycleSnapshot(raw: RawCyclePosition): MarketCycleSnapshot {
  const metrics = raw.metrics ?? {};
  const classification = raw.classification ?? {};
  const indices = metrics.indices ?? {};
  const marketWidth = metrics.market_width ?? {};
  const turnover = metrics.turnover ?? {};

  return {
    targetDate: String(metrics.target_date ?? ""),
    phase: String(classification.phase ?? "未知"),
    cycleAnchor: String(classification.cycle_anchor ?? "未知"),
    compositePositionPct: numberValue(classification.composite_position_pct),
    shortTermState: String(classification.short_term_state ?? classification.phase ?? "未知"),
    positionBand: String(classification.position_band ?? "未知"),
    suggestedPositionPct: String(classification.suggested_position_pct ?? "40%-55%"),
    action: String(classification.action ?? "观察"),
    confidence: String(classification.confidence ?? "低"),
    missing: Array.isArray(classification.missing) ? classification.missing.map(String) : [],
    riskTriggers: Array.isArray(classification.risk_triggers) ? classification.risk_triggers.map(String) : [],
    addTriggers: Array.isArray(classification.add_triggers) ? classification.add_triggers.map(String) : [],
    indices: ["sh", "cyb", "hs300", "zz1000"].map((key) => mapIndex(key, indices[key] ?? {})),
    turnover: {
      totalTurnoverYi: numberValue(turnover.total_turnover_yi),
      ratios: {
        vs_5d: numberValue(turnover.ratios?.vs_5d),
        vs_20d: numberValue(turnover.ratios?.vs_20d),
        vs_60d: numberValue(turnover.ratios?.vs_60d),
        vs_120d: numberValue(turnover.ratios?.vs_120d),
        vs_250d: numberValue(turnover.ratios?.vs_250d)
      }
    },
    marketWidth: {
      limitUpCount: numberValue(marketWidth.limit_up_count),
      limitDownCount: numberValue(marketWidth.limit_down_count),
      failedLimitUpCount: numberValue(marketWidth.failed_limit_up_count),
      limitUpOpenFailureRate: numberValue(marketWidth.limit_up_open_failure_rate),
      highestConsecutiveLimit: numberValue(marketWidth.highest_consecutive_limit),
      topIndustries: Array.isArray(marketWidth.top_industries)
        ? marketWidth.top_industries.map((item: [unknown, unknown]) => [String(item[0]), numberValue(item[1])] as [string, number])
        : []
    }
  };
}

export function mapCyclePositionToPositionStatus(
  raw: RawCyclePosition,
  portfolio: PortfolioExposureSummary
): PositionStatus {
  const cycle = mapCycleSnapshot(raw);
  const metrics = raw.metrics ?? {};
  const sentiment = buildRetailSentimentFromCycle({
    targetDate: cycle.targetDate,
    turnoverVs20d: metrics.turnover?.ratios?.vs_20d ?? null,
    turnoverPercentile: metrics.turnover?.ratios?.vs_20d ? Math.min(Math.max(Number(metrics.turnover.ratios.vs_20d) * 50, 0), 100) : null,
    advancersRatio: metrics.advancers_ratio ?? null,
    limitUpCount: metrics.market_width?.limit_up_count ?? null,
    limitDownCount: metrics.market_width?.limit_down_count ?? null,
    highestConsecutiveLimit: metrics.market_width?.highest_consecutive_limit ?? null,
    limitUpOpenFailureRate: metrics.market_width?.limit_up_open_failure_rate ?? null,
    marginBalanceChangePct: metrics.margin_change_pct ?? null,
    topIndustries: cycle.marketWidth.topIndustries,
    grossExposure: portfolio.exposurePct / 100,
    singleNameMax: portfolio.singleNameMaxPct / 100
  });
  const band = parsePositionBand(cycle.suggestedPositionPct);
  const finalGate = resolvePositionGate({
    finalMin: band.min,
    finalMax: band.max,
    currentExposure: portfolio.exposurePct
  });

  return {
    cycle,
    sentiment,
    band,
    finalGate,
    currentExposurePct: portfolio.exposurePct,
    ruleCandidates: [
      {
        ruleId: "RHI-BREAKDOWN-CAP",
        scenario: "中期破位或宽基分化时限制仓位上限",
        status: "观察假设",
        hypothesis: "中性区间内仍会发生快速下跌，破位/宽基分化应压低仓位上限。",
        confidence: "低",
        adoptionAction: "作为仓位闸门使用：低置信数据下最高不超过试探仓。",
        triggeredToday: finalGate.gate === "blocked" || finalGate.gate === "watch_only"
      },
      {
        ruleId: "RHI-WIDTH-COLLAPSE",
        scenario: "上涨家数占比偏弱、跌停扩散或炸板率升高",
        status: "观察假设",
        hypothesis: "宽度塌陷更像追涨失败风险过滤器。",
        confidence: "低",
        adoptionAction: "覆盖原始RHI等级并下调进攻仓位。",
        triggeredToday: cycle.marketWidth.limitDownCount >= 20 || cycle.marketWidth.limitUpOpenFailureRate >= 0.35
      }
    ]
  };
}

async function latestCycleFile(): Promise<string> {
  const files = await readdir(SIGNALS_DIR);
  const matches = files.filter((file) => /^\d{4}-\d{2}-\d{2}-market-cycle-position\.json$/.test(file)).sort();
  if (matches.length === 0) throw new Error("No market-cycle-position JSON files found");
  return path.resolve(SIGNALS_DIR, matches[matches.length - 1]);
}

async function readCycleFile(filePath: string): Promise<RawCyclePosition> {
  return JSON.parse(await readFile(filePath, "utf-8")) as RawCyclePosition;
}

async function runMarketCycleRefresh(): Promise<string> {
  if (!existsSync(MARKET_CYCLE_SCRIPT)) {
    throw new Error(`market cycle refresh script not found: ${MARKET_CYCLE_SCRIPT}`);
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(PYTHON_EXE, [MARKET_CYCLE_SCRIPT], {
      cwd: ROOT_DIR,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let errorOutput = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("market cycle refresh timed out"));
    }, 180_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(errorOutput || `market cycle refresh exited with code ${code}`));
        return;
      }
      const firstJsonPath = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.endsWith("-market-cycle-position.json"));
      resolve(firstJsonPath || "");
    });
  });
}

export async function getPositionStatusResponse(
  portfolio: PortfolioExposureSummary,
  options?: { refresh?: boolean }
): Promise<PositionStatusResponse> {
  const warnings: string[] = [...MARKET_CYCLE_WORKSPACE.warnings];
  if (MARKET_CYCLE_WORKSPACE.source === "snapshot") {
    warnings.push("Using git-tracked market cycle snapshot; set SHOUZHUO_MARKET_ROOT to enable cloud-side refresh.");
  }
  let filePath = "";
  let mode: "refreshed" | "cached" = "cached";

  if (options?.refresh) {
    try {
      filePath = await runMarketCycleRefresh();
      mode = "refreshed";
    } catch (error) {
      warnings.push(`市场情绪刷新失败，使用本地最近结果：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!filePath) {
    try {
      filePath = await latestCycleFile();
    } catch (error) {
      warnings.push(`本地市场情绪文件缺失，使用云端保守兜底：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const raw = filePath ? await readCycleFile(filePath) : fallbackCyclePosition();
  return {
    status: mapCyclePositionToPositionStatus(raw, portfolio),
    source: {
      mode,
      file: filePath || "cloud-fallback",
      refreshedAt: new Date().toISOString(),
      warnings
    }
  };
}
