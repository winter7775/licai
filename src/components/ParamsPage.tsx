import { getStrategyParams } from "../data/apiClient";

export function ParamsPage() {
  const params = getStrategyParams();

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>策略参数</h2>
            <p>{params.version}</p>
          </div>
        </div>
        <div className="params-grid">
          <label>
            大盘最低分
            <input readOnly value={params.market.minIndexScore} />
          </label>
          <label>
            止损上限
            <input readOnly value={`${params.stock.maxStopLossPct}%`} />
          </label>
          <label>
            止盈目标
            <input readOnly value={`${params.stock.mainTakeProfitPct}%`} />
          </label>
          <label>
            单票上限
            <input readOnly value={`${params.stock.maxSinglePositionPct}%`} />
          </label>
          <label>
            行业上限
            <input readOnly value={`${params.stock.maxIndustryPositionPct}%`} />
          </label>
          <label>
            最多持股
            <input readOnly value={`${params.stock.maxHoldings} 只`} />
          </label>
          <label>
            平台最少天数
            <input readOnly value={`${params.pattern.minPlatformDays} 天`} />
          </label>
          <label>
            平台最大宽度
            <input readOnly value={`${params.pattern.maxPlatformWidthPct}%`} />
          </label>
          <label>
            突破放量
            <input readOnly value={`${params.pattern.minBreakoutVolumeRatio}x`} />
          </label>
        </div>
      </section>
    </div>
  );
}
