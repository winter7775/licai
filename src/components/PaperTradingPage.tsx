import { Bot, CheckCircle2, DatabaseZap, Play, RefreshCw, Search } from "lucide-react";
import type { PaperTradingResponseDto, PaperScanStateDto } from "../live/liveTypes";

interface PaperTradingPageProps {
  paperTrading: PaperTradingResponseDto | null;
  loading: boolean;
  onRefresh: () => void;
  onRun: () => void;
  onRunScanBatch: () => void;
}

function money(value: number | undefined): string {
  return value === undefined ? "--" : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function pct(value: number | undefined): string {
  return value === undefined ? "--" : `${value.toFixed(2)}%`;
}

function count(value: number | undefined): string {
  return value === undefined ? "--" : value.toLocaleString("zh-CN");
}

function timeText(value: string | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function scanStatusLabel(status: string | undefined): string {
  if (status === "complete") return "已完成";
  if (status === "running") return "扫描中";
  if (status === "error") return "异常";
  return "待扫描";
}

function scanPolicy(scanState: PaperScanStateDto | undefined) {
  return (
    scanState?.scanPolicy ?? {
      marketCapTopPct: 30,
      initialPoolTarget: 400,
      dailyLimit: scanState?.dailyLimit ?? 400,
      batchSize: scanState?.batchSize ?? 40
    }
  );
}

function diagnosisText(scanState: PaperScanStateDto | undefined): string {
  const attribution = scanState?.attribution;
  if (!scanState || !attribution) return "后台扫描尚未开始，先跑一批建立样本。";
  if (attribution.strictEligibleCount > 0) return `当前有 ${attribution.strictEligibleCount} 只股票满足严格买入规则，可进入模拟盘下单候选。`;
  if (attribution.nearMissCount > 0) return `暂无严格可买，但有 ${attribution.nearMissCount} 只股票只差 1-2 个非底线硬规则，适合复盘规则是否过紧。`;
  if (scanState.analyzedCount > 0) return "当前已扫描样本中没有严格可买，也没有接近可买标的，系统不会强行建仓。";
  return "后台扫描尚未开始，先跑一批建立样本。";
}

export function PaperTradingPage({ paperTrading, loading, onRefresh, onRun, onRunScanBatch }: PaperTradingPageProps) {
  const summary = paperTrading?.summary;
  const latestReview = paperTrading?.account.reviews[0];
  const latestRun = paperTrading?.run;
  const scanState = paperTrading?.scanState;
  const attribution = scanState?.attribution;
  const policy = scanPolicy(scanState);
  const scanDenominator = Math.max(scanState?.prefilteredCount ?? policy.dailyLimit, 1);
  const scanProgressPct = Math.min(100, ((scanState?.cursor ?? 0) / scanDenominator) * 100);
  const rejectedCount = Math.max((scanState?.analyzedCount ?? 0) - (attribution?.strictEligibleCount ?? 0), 0);

  return (
    <div className="page-stack">
      <section className="paper-hero">
        <div>
          <p className="eyebrow">自动模拟交易</p>
          <h2>20 万虚拟资金，按系统规则自行运行</h2>
          <p>股票池先限定为总市值前 30%，再用流动性、估值、换手和形态规则逐层筛选。</p>
        </div>
        <div className="paper-actions">
          <button className="icon-text-button" disabled={loading} onClick={onRefresh} type="button">
            <RefreshCw className={loading ? "spinning" : ""} size={16} />
            <span>刷新</span>
          </button>
          <button className="icon-text-button primary" disabled={loading} onClick={onRun} type="button">
            <Play size={16} />
            <span>自动运行</span>
          </button>
        </div>
      </section>

      <div className="portfolio-summary">
        <div>
          <span>总资产</span>
          <strong>{money(summary?.totalAssets)}</strong>
          <p>初始资金 {money(summary?.initialCapital)}</p>
        </div>
        <div>
          <span>现金</span>
          <strong>{money(summary?.cash)}</strong>
          <p>仓位 {pct(summary?.exposurePct)}</p>
        </div>
        <div>
          <span>累计收益</span>
          <strong className={summary && summary.totalReturn >= 0 ? "gain" : "loss"}>{money(summary?.totalReturn)}</strong>
          <p>{pct(summary?.totalReturnPct)}</p>
        </div>
      </div>

      <section className="panel paper-attribution-panel" data-testid="paper-attribution-panel">
        <div className="panel-heading paper-attribution-heading">
          <div>
            <h2>扫描与未买入归因</h2>
            <p>策略 v2：核心风控用于下单，平台收敛改为组合评分，并用完整样本检验阈值。</p>
          </div>
          <div className="paper-actions">
            <span className={`status-pill ${scanState?.status === "complete" ? "good" : scanState?.status === "error" ? "bad" : "neutral"}`}>
              {scanStatusLabel(scanState?.status)}
            </span>
            <button
              className="icon-text-button"
              data-testid="paper-scan-step-button"
              disabled={loading || scanState?.status === "complete"}
              onClick={onRunScanBatch}
              type="button"
            >
              <Search size={16} />
              <span>{scanState?.status === "complete" ? "扫描完成" : "自动扫描 400 只"}</span>
            </button>
          </div>
        </div>

        <div className="scan-policy-strip" data-testid="paper-scan-policy">
          <div>
            <span>1. 股票池</span>
            <strong>市值前 {policy.marketCapTopPct}%</strong>
            <p>
              全市场 {count(scanState?.universeCount)} 只，入池 {count(scanState?.marketCapUniverseCount)} 只，优先规避小市值操纵风险。
            </p>
          </div>
          <div>
            <span>2. 初筛池</span>
            <strong>目标 {count(policy.initialPoolTarget)} 只</strong>
            <p>仅剔除 ST、新股、低流动性、极端换手和极端涨跌；PE 与普通波动改为排序因子。</p>
          </div>
          <div>
            <span>3. 详细扫描</span>
            <strong>{count(scanState?.analyzedCount)} / {count(scanState?.prefilteredCount || policy.dailyLimit)}</strong>
            <p>逐只拉日线，计算趋势、平台、缩量、ATR、波动率、突破/回踩和止损宽度。</p>
          </div>
          <div>
            <span>4. 模拟执行</span>
            <strong>{count(attribution?.strictEligibleCount)} 只可买</strong>
            <p>只有严格买入规则通过，才会进入 20 万模拟资金的自动下单候选。</p>
          </div>
        </div>

        <div className="scan-progress-block">
          <div className="scan-progress-copy">
            <strong>
              当前批次 {count(scanState?.cursor)} / {count(scanState?.prefilteredCount || policy.dailyLimit)}
            </strong>
            <span>
              自动分批扫描 · 每批 {count(policy.batchSize)} 只 · 目标 {count(policy.dailyLimit)} 只 · 更新时间 {timeText(scanState?.updatedAt)}
            </span>
          </div>
          <div className="scan-progress">
            <div>
              <i style={{ width: `${scanProgressPct}%` }} />
            </div>
            <span>{scanProgressPct.toFixed(1)}%</span>
          </div>
        </div>

        <div className="attribution-stats">
          <div>
            <span>严格可买</span>
            <strong>{count(attribution?.strictEligibleCount)}</strong>
            <p>进入自动下单候选</p>
          </div>
          <div>
            <span>接近可买</span>
            <strong>{count(attribution?.nearMissCount)}</strong>
            <p>只差 1-2 个非底线硬规则</p>
          </div>
          <div>
            <span>观察信号</span>
            <strong>{count(attribution?.watchCount)}</strong>
            <p>形态还没有确认</p>
          </div>
          <div>
            <span>已排除</span>
            <strong>{count(rejectedCount)}</strong>
            <p>不满足严格买入条件</p>
          </div>
        </div>

        <div className="attribution-workbench">
          <div className="attribution-section">
            <div className="section-title">
              <DatabaseZap size={16} />
              <h3>主要卡点</h3>
            </div>
            <div className="rule-failure-table">
              {(attribution?.ruleFailures ?? []).slice(0, 8).map((item) => (
                <div className="rule-failure-row" key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{item.failedCount} 次</span>
                  <small>{item.sampleActuals.slice(0, 3).join(" / ")}</small>
                </div>
              ))}
              {(attribution?.ruleFailures.length ?? 0) === 0 ? <p className="empty-note">还没有失败规则样本</p> : null}
            </div>
          </div>

          <div className="attribution-section">
            <div className="section-title">
              <CheckCircle2 size={16} />
              <h3>候选明细</h3>
            </div>
            <div className="near-miss-table">
              {(attribution?.rejections ?? []).slice(0, 8).map((item) => (
                <div className="near-miss-row" key={item.symbol}>
                  <strong>
                    {item.symbol} {item.name}
                  </strong>
                  <span className={item.relaxedEligible ? "gain" : "muted-text"}>
                    {item.relaxedEligible ? "接近可买" : item.signalType === "watch" ? "观察" : "未通过"}
                  </span>
                  <small>{item.failedHardRules.join(" / ") || "观察信号未确认"}</small>
                </div>
              ))}
              {(attribution?.rejections.length ?? 0) === 0 ? <p className="empty-note">暂无候选明细</p> : null}
            </div>
          </div>
        </div>

        <p className="diagnosis-note">{diagnosisText(scanState)}</p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>当前模拟持仓</h2>
            <p>{paperTrading?.quoteStatus.mode === "live" ? "持仓现价已接入行情" : "暂无持仓或暂用成本价估算"}</p>
          </div>
          <span>{summary?.holdings.length ?? 0} 只</span>
        </div>
        <div className="table-wrap">
          <table className="signal-table portfolio-table">
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th>数量</th>
                <th>成本</th>
                <th>现价</th>
                <th>市值</th>
                <th>盈亏</th>
                <th>仓位</th>
                <th>止损/止盈</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.holdings ?? []).map((holding) => (
                <tr key={holding.symbol}>
                  <td className="mono">{holding.symbol}</td>
                  <td>
                    <strong>{holding.name}</strong>
                    <small>{holding.reason}</small>
                  </td>
                  <td>{holding.quantity}</td>
                  <td>{holding.avgCost}</td>
                  <td>{holding.currentPrice}</td>
                  <td>{money(holding.marketValue)}</td>
                  <td className={holding.unrealizedPnl >= 0 ? "gain" : "loss"}>{money(holding.unrealizedPnl)}</td>
                  <td>{pct(holding.weightPct)}</td>
                  <td>
                    {holding.stopPrice} / {holding.takeProfitPrice}
                  </td>
                </tr>
              ))}
              {(summary?.holdings.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <p className="empty-note">暂无模拟持仓。系统会等待严格买入规则出现后再建仓。</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="paper-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>今日复盘</h2>
              <p>{latestReview?.date ?? "尚未运行"}</p>
            </div>
            <Bot size={18} />
          </div>
          <div className="review-box">
            <strong>{latestReview?.actionSummary ?? "等待第一次自动运行"}</strong>
            <p>
              {latestRun
                ? `全市场 ${latestRun.scan.universeCount} 只 · 初筛 ${latestRun.scan.prefilteredCount} 只 · 精筛 ${latestRun.scan.analyzedCount} 只`
                : "模拟盘会使用后台扫描候选池、市场情绪仓位区间和单票风控一起决策。"}
            </p>
            <ul>
              {(latestReview?.decisions ?? ["还没有复盘记录"]).slice(0, 6).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>最近交易</h2>
              <p>自动模拟交易流水</p>
            </div>
            <span>{paperTrading?.account.trades.length ?? 0} 笔</span>
          </div>
          <div className="trade-list">
            {(paperTrading?.account.trades ?? []).slice(-8).reverse().map((trade) => (
              <div className="trade-item" key={trade.id}>
                <span className={`status-pill ${trade.side === "buy" ? "good" : "warn"}`}>{trade.side === "buy" ? "买入" : "卖出"}</span>
                <strong>
                  {trade.symbol} {trade.name}
                </strong>
                <p>
                  {trade.quantity} 股 · {trade.price} · {money(trade.amount)}
                </p>
              </div>
            ))}
            {(paperTrading?.account.trades.length ?? 0) === 0 ? <p className="empty-note">暂无交易流水</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
