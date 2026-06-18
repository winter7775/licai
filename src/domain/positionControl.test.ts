import { describe, expect, it } from "vitest";
import {
  applyPositionGateToSignal,
  parsePositionBand,
  resolvePositionGate
} from "./positionControl";

const baseSignal = {
  id: "sig-001",
  tradability: "可买" as const,
  suggestedPositionPct: 8
};

describe("position control", () => {
  it("parses position bands from the market-cycle snapshot", () => {
    expect(parsePositionBand("20%-35%")).toEqual({ min: 20, max: 35 });
    expect(parsePositionBand("40% - 60%")).toEqual({ min: 40, max: 60 });
  });

  it("blocks new entries when current exposure is above the final max", () => {
    const result = resolvePositionGate({
      finalMin: 20,
      finalMax: 35,
      currentExposure: 59.3
    });

    expect(result.gate).toBe("blocked");
    expect(result.riskMultiplier).toBe(0);
    expect(result.reason).toContain("当前仓位");
  });

  it("downgrades to watch only when exposure is near the final max", () => {
    const result = resolvePositionGate({
      finalMin: 35,
      finalMax: 50,
      currentExposure: 47
    });

    expect(result.gate).toBe("watch_only");
    expect(result.riskMultiplier).toBe(0);
  });

  it("halves risk in defensive but not fully blocked markets", () => {
    const result = resolvePositionGate({
      finalMin: 35,
      finalMax: 50,
      currentExposure: 30
    });

    expect(result.gate).toBe("half");
    expect(result.riskMultiplier).toBe(0.5);
  });

  it("applies gate results to signal tradability", () => {
    expect(applyPositionGateToSignal("blocked", baseSignal).tradability).toBe("观察");
    expect(applyPositionGateToSignal("watch_only", baseSignal).tradability).toBe("观察");
    expect(applyPositionGateToSignal("half", baseSignal).tradability).toBe("半仓");
    expect(applyPositionGateToSignal("normal", baseSignal).tradability).toBe("可买");
  });
});
