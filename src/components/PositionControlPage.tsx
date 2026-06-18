import { RefreshCw } from "lucide-react";
import type { PositionStatus } from "../domain/types";
import type { PositionStatusResponseDto } from "../live/liveTypes";

interface PositionControlPageProps {
  position: PositionStatus;
  source: PositionStatusResponseDto["source"] | null;
  onRefresh: () => void;
  refreshing: boolean;
}

export function PositionControlPage({ position, source, onRefresh, refreshing }: PositionControlPageProps) {
  return (
    <div className="page-stack">
      <section className="position-summary">
        <div>
          <span>基础仓位区间</span>
          <strong>{position.cycle.suggestedPositionPct}</strong>
          <p>{position.cycle.phase}</p>
        </div>
        <div>
          <span>最终闸门</span>
          <strong>{position.finalGate.label}</strong>
          <p>{position.finalGate.reason}</p>
        </div>
        <div>
          <span>当前仓位</span>
          <strong>{position.currentExposurePct}%</strong>
          <p>上限 {position.band.max}%</p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>RHI 情绪结构</h2>
            <p>
              {position.sentiment.asOf} · {position.sentiment.regime}
              {source ? ` · ${source.mode === "refreshed" ? "已刷新" : "本地缓存"}` : ""}
            </p>
          </div>
          <button className="icon-text-button" disabled={refreshing} onClick={onRefresh} type="button">
            <RefreshCw className={refreshing ? "spinning" : ""} size={16} />
            <span>{refreshing ? "刷新中" : "刷新情绪"}</span>
          </button>
        </div>
        <div className="score-bars">
          {position.sentiment.categoryScores.map((item) => (
            <div className="score-bar" key={item.name}>
              <span>{item.name}</span>
              <div>
                <i style={{ width: `${item.score ?? 0}%` }} />
              </div>
              <strong>{item.score ?? "缺失"}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>一年波段位置</h2>
            <p>
              {position.cycle.cycleAnchor} · 综合分位 {position.cycle.compositePositionPct}%
            </p>
          </div>
          <span>{position.cycle.confidence}</span>
        </div>
        <div className="index-grid">
          {position.cycle.indices.map((index) => (
            <div className="index-tile" key={index.key}>
              <span>{index.name}</span>
              <strong>{index.oneYearPositionPct}%</strong>
              <p>
                收盘 {index.close} · 回撤 {index.drawdownFromHighPct}%
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>规则候选</h2>
            <p>观察假设只能降级风险，不能升级买点</p>
          </div>
        </div>
        <div className="rule-candidate-list">
          {position.ruleCandidates.map((rule) => (
            <article key={rule.ruleId}>
              <div>
                <strong>{rule.ruleId}</strong>
                <span className={`status-pill ${rule.triggeredToday ? "warn" : "neutral"}`}>
                  {rule.triggeredToday ? "今日触发" : "未触发"}
                </span>
              </div>
              <p>{rule.scenario}</p>
              <small>{rule.adoptionAction}</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
