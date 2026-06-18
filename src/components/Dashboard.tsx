import { AlertTriangle, Database, ShieldCheck, TrendingUp } from "lucide-react";
import type { PositionStatus, SignalCandidate } from "../domain/types";
import type { PageKey } from "./AppShell";
import { MetricCard } from "./MetricCard";
import { RuleInspector } from "./RuleInspector";
import { SignalTable } from "./SignalTable";
import { getDataHealth, getMarketStatus } from "../data/apiClient";
import type { LiveUiState } from "../live/liveTypes";

interface DashboardProps {
  signals: SignalCandidate[];
  selectedSignal: SignalCandidate;
  onSelectSignal: (signal: SignalCandidate) => void;
  onOpenPage: (page: PageKey) => void;
  liveState: LiveUiState;
  position: PositionStatus;
}

export function Dashboard({ signals, selectedSignal, onSelectSignal, onOpenPage, liveState, position }: DashboardProps) {
  const market = getMarketStatus();
  const health = getDataHealth();
  const marketSwitch = position.finalGate.gate === "blocked" ? "红灯" : market.overview.marketSwitch;

  return (
    <div className="dashboard-grid">
      <section className="hero-band">
        <div>
          <p className="eyebrow">今日组合结论</p>
          <h2>{position.cycle.action}</h2>
          <span>
            {position.cycle.phase} · {position.cycle.suggestedPositionPct} · 当前仓位 {position.currentExposurePct}%
          </span>
        </div>
        <button type="button" onClick={() => onOpenPage("position")}>
          查看仓位管控
        </button>
      </section>

      <div className="metric-grid">
        <MetricCard label="大盘开关" value={marketSwitch} detail={position.finalGate.reason} tone="bad">
          <AlertTriangle size={18} />
        </MetricCard>
        <MetricCard label="仓位闸门" value={position.finalGate.label} detail={`${position.band.min}%-${position.band.max}%`} tone="warn">
          <ShieldCheck size={18} />
        </MetricCard>
        <MetricCard label="RHI 热度" value={`${position.sentiment.retailHeat}/100`} detail={`${position.sentiment.regime} · 置信度${position.sentiment.confidence}`} tone="neutral">
          <TrendingUp size={18} />
        </MetricCard>
        <MetricCard
          label="数据状态"
          value={liveState.status === "live" ? "现网行情" : liveState.status === "loading" ? "扫描中" : health.mode}
          detail={liveState.scan ? `交易日 ${liveState.scan.tradeDate} · ${liveState.scan.sourceLabel}` : "本地快照降级"}
          tone={liveState.status === "live" ? "good" : liveState.status === "fallback" ? "warn" : "neutral"}
        >
          <Database size={18} />
        </MetricCard>
      </div>

      <div className="content-grid">
        <SignalTable signals={signals} selectedId={selectedSignal.id} onSelect={onSelectSignal} />
        <RuleInspector signal={selectedSignal} />
      </div>
    </div>
  );
}
