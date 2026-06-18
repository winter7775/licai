import type { SignalCandidate } from "../domain/types";
import { Sparkline } from "./Sparkline";

interface SignalTableProps {
  signals: SignalCandidate[];
  selectedId: string;
  onSelect: (signal: SignalCandidate) => void;
}

function tradabilityClass(value: SignalCandidate["tradability"]) {
  if (value === "可买") return "good";
  if (value === "半仓") return "warn";
  if (value === "不可买") return "bad";
  return "neutral";
}

export function SignalTable({ signals, selectedId, onSelect }: SignalTableProps) {
  return (
    <section className="panel signal-table-panel">
      <div className="panel-heading">
        <div>
          <h2>信号列表</h2>
          <p>按客观规则输出，仓位闸门优先于个股买点</p>
        </div>
        <span>{signals.length} 只</span>
      </div>

      <div className="table-wrap">
        <table className="signal-table">
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>买点</th>
              <th>行业</th>
              <th>通过</th>
              <th>止损</th>
              <th>止盈</th>
              <th>仓位</th>
              <th>走势</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((signal) => (
              <tr
                className={selectedId === signal.id ? "selected" : ""}
                key={signal.id}
                onClick={() => onSelect(signal)}
              >
                <td className="mono">{signal.symbol}</td>
                <td>
                  <strong>{signal.name}</strong>
                  <small>{signal.tags.join(" / ")}</small>
                </td>
                <td>{signal.signalLabel}</td>
                <td>{signal.industry}</td>
                <td>
                  {signal.score.passedCount}/{signal.score.totalCount}
                </td>
                <td>{signal.stopLossWidthPct}%</td>
                <td>{signal.takeProfitMain.toFixed(2)}</td>
                <td>
                  <span className={`status-pill ${tradabilityClass(signal.tradability)}`}>{signal.tradability}</span>
                </td>
                <td>
                  <Sparkline values={signal.sparkline} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
