import type { PositionGate, PositionGateResult, SignalCandidate, Tradability } from "./types";

export function parsePositionBand(text: string): { min: number; max: number } {
  const matches = text.match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 2) {
    throw new Error(`Invalid position band: ${text}`);
  }

  return {
    min: Number(matches[0]),
    max: Number(matches[1])
  };
}

export function resolvePositionGate(input: {
  finalMin?: number;
  finalMax: number;
  currentExposure: number;
}): PositionGateResult {
  const min = input.finalMin ?? 0;
  const max = input.finalMax;
  const exposure = input.currentExposure;

  if (exposure > max) {
    return {
      min,
      max,
      gate: "blocked",
      label: "禁止开新仓",
      reason: `当前仓位 ${exposure.toFixed(1)}% 已超过建议上限 ${max.toFixed(1)}%。`,
      riskMultiplier: 0
    };
  }

  if (exposure >= max - 5) {
    return {
      min,
      max,
      gate: "watch_only",
      label: "只观察",
      reason: `当前仓位距离建议上限不足 5%，新信号先降级观察。`,
      riskMultiplier: 0
    };
  }

  if (max <= 35) {
    return {
      min,
      max,
      gate: "watch_only",
      label: "防守观察",
      reason: `组合仓位上限仅 ${max.toFixed(1)}%，只允许观察，不主动开新仓。`,
      riskMultiplier: 0
    };
  }

  if (max <= 50) {
    return {
      min,
      max,
      gate: "half",
      label: "半风险",
      reason: `仓位上限 ${max.toFixed(1)}% 仍处防守区，单笔风险减半。`,
      riskMultiplier: 0.5
    };
  }

  return {
    min,
    max,
    gate: "normal",
    label: "正常执行",
    reason: `当前仓位低于建议上限，允许按系统风险执行。`,
    riskMultiplier: 1
  };
}

export function gateToTradability(gate: PositionGate): Tradability {
  if (gate === "normal") return "可买";
  if (gate === "half") return "半仓";
  return "观察";
}

export function applyPositionGateToSignal<T extends { tradability: Tradability; suggestedPositionPct: number }>(
  gate: PositionGate,
  signal: T
): T {
  const tradability = gateToTradability(gate);
  const suggestedPositionPct =
    gate === "half" ? Number((signal.suggestedPositionPct * 0.5).toFixed(2)) : signal.suggestedPositionPct;

  return {
    ...signal,
    tradability,
    suggestedPositionPct
  };
}

export function applyResolvedGateToCandidate(candidate: SignalCandidate, gateResult: PositionGateResult): SignalCandidate {
  const gated = applyPositionGateToSignal(gateResult.gate, candidate);
  return {
    ...candidate,
    tradability: gated.tradability,
    suggestedPositionPct: gated.suggestedPositionPct,
    gate: gateResult.gate,
    gateReason: gateResult.reason
  };
}
