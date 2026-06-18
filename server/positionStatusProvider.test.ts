import { describe, expect, it } from "vitest";
import { mapCyclePositionToPositionStatus } from "./positionStatusProvider";

describe("position status provider", () => {
  it("maps refreshed cycle data and portfolio exposure into a position gate", () => {
    const status = mapCyclePositionToPositionStatus(
      {
        metrics: {
          target_date: "2026-06-05",
          indices: {
            sh: {
              close: 4000,
              one_year_position_pct: 80,
              drawdown_from_high_pct: -3,
              returns: { "5d": 1, "20d": 2, "60d": 3, "120d": 4, "250d": 5 }
            },
            cyb: {
              close: 3000,
              one_year_position_pct: 90,
              drawdown_from_high_pct: -2,
              returns: { "5d": 1, "20d": 2, "60d": 3, "120d": 4, "250d": 5 }
            },
            hs300: {
              close: 4500,
              one_year_position_pct: 85,
              drawdown_from_high_pct: -2,
              returns: { "5d": 1, "20d": 2, "60d": 3, "120d": 4, "250d": 5 }
            },
            zz1000: {
              close: 8000,
              one_year_position_pct: 88,
              drawdown_from_high_pct: -4,
              returns: { "5d": 1, "20d": 2, "60d": 3, "120d": 4, "250d": 5 }
            }
          },
          turnover: {
            total_turnover_yi: 25000,
            ratios: { vs_20d: 1.1, vs_60d: 1.2, vs_250d: 1.3 }
          },
          market_width: {
            limit_up_count: 70,
            limit_down_count: 12,
            failed_limit_up_count: 20,
            limit_up_open_failure_rate: 0.22,
            highest_consecutive_limit: 4,
            top_industries: [["半导体", 7]]
          },
          margin_change_pct: 0.05
        },
        classification: {
          phase: "高位修复观察",
          cycle_anchor: "一年高位区间",
          composite_position_pct: 86,
          short_term_state: "高位修复观察",
          position_band: "观察偏防守",
          suggested_position_pct: "30%-45%",
          action: "控制仓位",
          confidence: "中",
          risk_triggers: [],
          add_triggers: [],
          missing: []
        }
      },
      {
        exposurePct: 52,
        singleNameMaxPct: 12
      }
    );

    expect(status.cycle.targetDate).toBe("2026-06-05");
    expect(status.sentiment.asOf).toBe("2026-06-05 收盘");
    expect(status.currentExposurePct).toBe(52);
    expect(status.finalGate.gate).toBe("blocked");
  });
});
