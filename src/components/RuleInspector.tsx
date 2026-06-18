import { AlertTriangle, CheckCircle2, CircleSlash, Shield } from "lucide-react";
import type { SignalCandidate } from "../domain/types";

interface RuleInspectorProps {
  signal: SignalCandidate;
}

export function RuleInspector({ signal }: RuleInspectorProps) {
  return (
    <aside className="panel inspector">
      <div className="panel-heading">
        <div>
          <h2>{signal.name}</h2>
          <p>
            {signal.symbol} · {signal.signalLabel}
          </p>
        </div>
        <span className={`status-pill ${signal.tradability === "不可买" ? "bad" : signal.tradability === "半仓" ? "warn" : "neutral"}`}>
          {signal.tradability}
        </span>
      </div>

      <div className="price-grid">
        <div>
          <span>入场</span>
          <strong>{signal.entryPrice.toFixed(2)}</strong>
        </div>
        <div>
          <span>Pivot</span>
          <strong>{signal.pivotPrice.toFixed(2)}</strong>
        </div>
        <div>
          <span>止损</span>
          <strong>{signal.stopPrice.toFixed(2)}</strong>
        </div>
        <div>
          <span>40%目标</span>
          <strong>{signal.takeProfitMain.toFixed(2)}</strong>
        </div>
      </div>

      <div className="gate-box">
        <Shield size={18} />
        <div>
          <strong>仓位闸门：{signal.gate}</strong>
          <p>{signal.gateReason}</p>
        </div>
      </div>

      <div className="rule-list">
        {signal.rules.map((rule) => (
          <div className={`rule-row ${rule.passed ? "pass" : "fail"}`} key={rule.id}>
            {rule.passed ? <CheckCircle2 size={18} /> : rule.severity === "soft" ? <AlertTriangle size={18} /> : <CircleSlash size={18} />}
            <div>
              <strong>{rule.name}</strong>
              <p>
                实际 {rule.actual} · 阈值 {rule.threshold}
              </p>
              {rule.explanation ? <small>{rule.explanation}</small> : null}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
