import { DatabaseZap, RefreshCw, TriangleAlert } from "lucide-react";
import type { LiveUiState, ScanDepth } from "../live/liveTypes";

interface LiveDataToolbarProps {
  state: LiveUiState;
  scanDepth: ScanDepth;
  onDepthChange: (depth: ScanDepth) => void;
  onRefresh: () => void;
}

const SCAN_DEPTH_OPTIONS: Array<{ value: ScanDepth; label: string; title: string }> = [
  { value: "quick", label: "快速", title: "日线精筛 20 只" },
  { value: "standard", label: "标准", title: "日线精筛 80 只" },
  { value: "deep", label: "深度", title: "日线精筛 160 只" }
];

export function LiveDataToolbar({ state, scanDepth, onDepthChange, onRefresh }: LiveDataToolbarProps) {
  const live = state.status === "live" && state.scan;

  return (
    <section className={`live-toolbar ${state.status}`}>
      <div className="live-toolbar-icon">
        {state.status === "fallback" ? <TriangleAlert size={18} /> : <DatabaseZap size={18} />}
      </div>
      <div className="live-toolbar-copy">
        <strong>
          {state.status === "loading"
            ? "正在扫描全市场 A 股行情"
            : live
              ? `真实行情已更新 · 最近交易日 ${state.scan?.tradeDate || "未识别"}`
              : "真实行情暂不可用，已降级"}
        </strong>
        <span>
          {state.status === "loading"
            ? "先过滤全市场快照，再拉取符合条件股的前复权日线"
            : live
              ? `全市场 ${state.scan?.universeCount} 只 · 快照预筛 ${state.scan?.prefilteredCount} 只 · 日线精筛 ${state.scan?.analyzedCount} 只 · 推荐前 ${state.scan?.candidateCount} 只 · 用时 ${((state.scan?.durationMs ?? 0) / 1000).toFixed(1)} 秒`
              : state.error ?? "继续使用本地演示数据"}
        </span>
      </div>
      <div className="live-toolbar-actions">
        <div className="scan-depth-control" aria-label="扫描深度">
          {SCAN_DEPTH_OPTIONS.map((option) => (
            <button
              aria-pressed={scanDepth === option.value}
              className={scanDepth === option.value ? "active" : ""}
              disabled={state.status === "loading"}
              key={option.value}
              onClick={() => onDepthChange(option.value)}
              title={option.title}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <button className="refresh-button" disabled={state.status === "loading"} onClick={onRefresh} type="button" title="刷新真实行情">
          <RefreshCw className={state.status === "loading" ? "spinning" : ""} size={17} />
          <span>{state.status === "loading" ? "扫描中" : "刷新"}</span>
        </button>
      </div>
    </section>
  );
}
