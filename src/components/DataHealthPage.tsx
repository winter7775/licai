import { getDataHealth } from "../data/apiClient";
import type { PositionStatus } from "../domain/types";
import type { LiveUiState, PositionStatusResponseDto } from "../live/liveTypes";

interface DataHealthPageProps {
  liveState: LiveUiState;
  position: PositionStatus;
  positionSource: PositionStatusResponseDto["source"] | null;
}

export function DataHealthPage({ liveState, position, positionSource }: DataHealthPageProps) {
  const health = getDataHealth();
  const healthWarnings =
    liveState.status === "live"
      ? health.warnings.filter((warning) => !warning.includes("候选股为演示数据"))
      : health.warnings;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>数据源状态</h2>
            <p>
              周期 {position.cycle.targetDate} · 情绪 {position.sentiment.asOf}
            </p>
          </div>
          <span>{positionSource?.mode === "refreshed" ? "RHI 已刷新" : health.mode}</span>
        </div>
        {liveState.scan ? (
          <div className="live-health-summary">
            <strong>{liveState.scan.sourceLabel}</strong>
            <span>全市场 {liveState.scan.universeCount} 只</span>
            <span>初筛 {liveState.scan.prefilteredCount} 只</span>
            <span>精筛 {liveState.scan.analyzedCount} 只</span>
            <span>正式信号 {liveState.scan.signalCount} 只</span>
            <span>观察 {liveState.scan.watchCount} 只</span>
          </div>
        ) : null}
        <div className="provider-grid">
          {health.providers.map((provider) => (
            <div className="provider-tile" key={provider.name}>
              <strong>{provider.name}</strong>
              <span>{provider.status}</span>
              <p>{provider.scope}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>缺失与警示</h2>
            <p>页面会把缺口直接暴露，不把样本数据伪装成实时数据</p>
          </div>
        </div>
        <div className="warning-list">
          {[
            ...healthWarnings,
            ...position.sentiment.missingData,
            ...position.cycle.missing,
            ...(positionSource?.warnings ?? [])
          ].map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>来源明细</h2>
            <p>{positionSource ? positionSource.file : "RHI 来源"}</p>
          </div>
        </div>
        <div className="source-list">
          {position.sentiment.sources.map((source) => (
            <article key={source.name}>
              <div>
                <strong>{source.name}</strong>
                <span className={`status-pill ${source.status === "ok" ? "good" : source.status === "missing" ? "bad" : "warn"}`}>
                  {source.status}
                </span>
              </div>
              <p>
                {source.tier} · {source.timestamp}
              </p>
              <small>{source.note}</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
