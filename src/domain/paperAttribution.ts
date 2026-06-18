import type { RuleResult, RuleSeverity, SignalType } from "./types";

export interface PaperAttributionCandidate {
  symbol: string;
  name: string;
  industry?: string;
  price: number;
  signalType: SignalType;
  score: number;
  stopPrice?: number;
  takeProfitPrice?: number;
  suggestedPositionPct?: number;
  hardRulesPassed?: boolean;
  rules: RuleResult[];
}

export interface PaperRuleFailureSummary {
  id: string;
  name: string;
  severity: RuleSeverity;
  failedCount: number;
  sampleActuals: string[];
  sampleSymbols: string[];
}

export interface PaperCandidateRejection {
  symbol: string;
  name: string;
  signalType: SignalType;
  score: number;
  price: number;
  failedHardCount: number;
  failedHardRules: string[];
  failedHardRuleIds: string[];
  relaxedEligible: boolean;
  reason: string;
}

export interface PaperAttributionReport {
  updatedAt: string;
  totalCandidates: number;
  strictEligibleCount: number;
  relaxedEligibleCount: number;
  nearMissCount: number;
  watchCount: number;
  signalCount: number;
  diagnosis: string;
  ruleFailures: PaperRuleFailureSummary[];
  rejections: PaperCandidateRejection[];
}

const CRITICAL_RULE_IDS = new Set(["liquidity.prefilter", "risk.stop_loss", "risk.stop_loss_width"]);

function severityOf(rule: RuleResult): RuleSeverity {
  return rule.severity ?? "soft";
}

function hardFailures(candidate: PaperAttributionCandidate): RuleResult[] {
  return candidate.rules.filter((rule) => severityOf(rule) === "hard" && !rule.passed);
}

function decisionFailures(candidate: PaperAttributionCandidate): RuleResult[] {
  const failures = candidate.rules.filter(
    (rule) => !rule.passed && (severityOf(rule) === "hard" || rule.id === "buy.breakout")
  );
  return Array.from(new Map(failures.map((rule) => [rule.id, rule])).values());
}

function hardPassed(candidate: PaperAttributionCandidate): boolean {
  if (typeof candidate.hardRulesPassed === "boolean") return candidate.hardRulesPassed;
  return hardFailures(candidate).length === 0;
}

function isStrictEligible(candidate: PaperAttributionCandidate): boolean {
  return candidate.price > 0 && candidate.signalType !== "watch" && hardPassed(candidate);
}

function isRelaxedEligible(candidate: PaperAttributionCandidate, failures: RuleResult[]): boolean {
  if (candidate.price <= 0 || failures.length === 0 || failures.length > 2) return false;
  return !failures.some((rule) => CRITICAL_RULE_IDS.has(rule.id));
}

function actualText(value: string | number): string {
  return String(value);
}

function rejectionReason(failures: RuleResult[]): string {
  if (failures.length === 0) return "Signal is still watch-only.";
  return `Failed hard rules: ${failures.map((rule) => rule.name).join(", ")}`;
}

function diagnosis(report: Omit<PaperAttributionReport, "diagnosis">): string {
  if (report.strictEligibleCount > 0) {
    return `Strict rules found ${report.strictEligibleCount} buyable candidate(s).`;
  }
  if (report.nearMissCount > 0) {
    const topRule = report.ruleFailures[0];
    const topText = topRule ? ` Main blocker: ${topRule.name}.` : "";
    return `No strict buy candidate yet, but ${report.nearMissCount} candidate(s) are within 1-2 hard-rule gaps.${topText}`;
  }
  if (report.totalCandidates > 0) {
    const topRule = report.ruleFailures[0];
    return topRule
      ? `No strict buy candidate yet. The most frequent blocker is ${topRule.name}.`
      : "No strict buy candidate yet. Current candidates remain watch-only.";
  }
  return "No candidates have been scanned yet.";
}

export function buildPaperAttribution(
  candidates: PaperAttributionCandidate[],
  updatedAt = new Date().toISOString()
): PaperAttributionReport {
  const failureMap = new Map<string, PaperRuleFailureSummary>();
  const rejections: PaperCandidateRejection[] = [];
  let strictEligibleCount = 0;
  let relaxedEligibleCount = 0;
  let watchCount = 0;

  for (const candidate of candidates) {
    if (candidate.signalType === "watch") watchCount += 1;
    const failures = decisionFailures(candidate);
    const strictEligible = isStrictEligible(candidate);
    const relaxedEligible = !strictEligible && isRelaxedEligible(candidate, failures);

    if (strictEligible) {
      strictEligibleCount += 1;
    } else {
      if (relaxedEligible) relaxedEligibleCount += 1;
      rejections.push({
        symbol: candidate.symbol,
        name: candidate.name,
        signalType: candidate.signalType,
        score: candidate.score,
        price: candidate.price,
        failedHardCount: failures.length,
        failedHardRules: failures.map((rule) => rule.name),
        failedHardRuleIds: failures.map((rule) => rule.id),
        relaxedEligible,
        reason: rejectionReason(failures)
      });
    }

    for (const rule of failures) {
      const existing = failureMap.get(rule.id) ?? {
        id: rule.id,
        name: rule.name,
        severity: severityOf(rule),
        failedCount: 0,
        sampleActuals: [],
        sampleSymbols: []
      };
      existing.failedCount += 1;
      if (existing.sampleActuals.length < 3) existing.sampleActuals.push(actualText(rule.actual));
      if (existing.sampleSymbols.length < 5) existing.sampleSymbols.push(candidate.symbol);
      failureMap.set(rule.id, existing);
    }
  }

  const ruleFailures = Array.from(failureMap.values()).sort(
    (left, right) => right.failedCount - left.failedCount || left.id.localeCompare(right.id)
  );
  const sortedRejections = rejections
    .sort((left, right) => Number(right.relaxedEligible) - Number(left.relaxedEligible) || right.score - left.score)
    .slice(0, 12);
  const baseReport = {
    updatedAt,
    totalCandidates: candidates.length,
    strictEligibleCount,
    relaxedEligibleCount,
    nearMissCount: relaxedEligibleCount,
    watchCount,
    signalCount: candidates.length - watchCount,
    ruleFailures,
    rejections: sortedRejections
  };

  return {
    ...baseReport,
    diagnosis: diagnosis(baseReport)
  };
}
