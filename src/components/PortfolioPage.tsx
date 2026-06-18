import { RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import type { PortfolioHolding, PortfolioState } from "../domain/portfolio";
import type { PortfolioResponseDto } from "../live/liveTypes";

interface SearchResult {
  symbol: string;
  name: string;
  industry: string;
  price: number;
  changePct: number;
  source: string;
}

interface PortfolioPageProps {
  portfolio: PortfolioResponseDto | null;
  loading: boolean;
  onRefresh: () => void;
  onSaveHolding: (holding: PortfolioHolding) => Promise<void>;
  onSavePortfolio: (portfolio: PortfolioState) => Promise<void>;
}

const emptyHolding: PortfolioHolding = {
  symbol: "",
  name: "",
  quantity: 0,
  costPrice: 0,
  note: "",
  updatedAt: ""
};

export function PortfolioPage({ portfolio, loading, onRefresh, onSaveHolding, onSavePortfolio }: PortfolioPageProps) {
  const [form, setForm] = useState<PortfolioHolding>(emptyHolding);
  const [accountEquity, setAccountEquity] = useState("");
  const [cash, setCash] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  const summary = portfolio?.summary;
  const db = portfolio?.portfolio;

  function editHolding(holding: PortfolioHolding) {
    setForm(holding);
    setQuery(holding.symbol);
  }

  async function searchStock() {
    const text = query.trim();
    if (!text) return;
    setSearching(true);
    try {
      const response = await fetch(`/api/portfolio/search?q=${encodeURIComponent(text)}`);
      const payload = (await response.json()) as { results: SearchResult[] };
      setResults(payload.results);
    } finally {
      setSearching(false);
    }
  }

  async function saveHolding(quantityOverride?: number) {
    if (!form.symbol.trim()) return;
    setSaving(true);
    try {
      await onSaveHolding({
        ...form,
        symbol: form.symbol.trim().padStart(6, "0").slice(-6),
        quantity: quantityOverride ?? Number(form.quantity),
        costPrice: Number(form.costPrice),
        updatedAt: new Date().toISOString()
      });
      setForm(emptyHolding);
      setResults([]);
    } finally {
      setSaving(false);
    }
  }

  async function saveAccount() {
    if (!db) return;
    setSaving(true);
    try {
      await onSavePortfolio({
        ...db,
        accountEquity: Number(accountEquity || db.accountEquity),
        cash: Number(cash || db.cash)
      });
      setAccountEquity("");
      setCash("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="portfolio-layout">
      <section className="page-stack">
        <div className="portfolio-summary">
          <div>
            <span>账户权益</span>
            <strong>{summary ? summary.accountEquity.toLocaleString() : "--"}</strong>
            <p>现金 {summary ? summary.cash.toLocaleString() : "--"}</p>
          </div>
          <div>
            <span>持仓市值</span>
            <strong>{summary ? summary.marketValue.toLocaleString() : "--"}</strong>
            <p>仓位 {summary ? `${summary.exposurePct}%` : "--"}</p>
          </div>
          <div>
            <span>浮动盈亏</span>
            <strong className={summary && summary.unrealizedPnl >= 0 ? "gain" : "loss"}>
              {summary ? summary.unrealizedPnl.toLocaleString() : "--"}
            </strong>
            <p>最大单票 {summary ? `${summary.singleNameMaxPct}%` : "--"}</p>
          </div>
        </div>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>持仓数据库</h2>
              <p>{portfolio?.quoteStatus.mode === "live" ? "现价已接入 A 股行情" : "使用本地估算价格"}</p>
            </div>
            <button className="icon-text-button" disabled={loading} onClick={onRefresh} type="button">
              <RefreshCw className={loading ? "spinning" : ""} size={16} />
              <span>刷新</span>
            </button>
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
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.holdings ?? []).map((holding) => (
                  <tr key={holding.symbol}>
                    <td className="mono">{holding.symbol}</td>
                    <td>
                      <strong>{holding.name}</strong>
                      <small>{holding.industry}</small>
                    </td>
                    <td>{holding.quantity}</td>
                    <td>{holding.costPrice}</td>
                    <td>{holding.currentPrice}</td>
                    <td>{holding.marketValue.toLocaleString()}</td>
                    <td className={holding.unrealizedPnl >= 0 ? "gain" : "loss"}>{holding.unrealizedPnl.toLocaleString()}</td>
                    <td>{holding.weightPct}%</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" onClick={() => editHolding(holding)} title="编辑">
                          <Save size={15} />
                        </button>
                        <button type="button" onClick={() => void onSaveHolding({ ...holding, quantity: 0, updatedAt: new Date().toISOString() })} title="清仓">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <aside className="panel portfolio-editor">
        <div className="panel-heading">
          <div>
            <h2>更新持仓</h2>
            <p>代码、数量和成本会写回本地数据库</p>
          </div>
        </div>

        <div className="portfolio-form">
          <label>
            账户权益
            <input value={accountEquity} onChange={(event) => setAccountEquity(event.target.value)} placeholder={db?.accountEquity.toString() ?? ""} />
          </label>
          <label>
            现金
            <input value={cash} onChange={(event) => setCash(event.target.value)} placeholder={db?.cash.toString() ?? ""} />
          </label>
          <button className="icon-text-button full" disabled={!db || saving} onClick={() => void saveAccount()} type="button">
            <Save size={16} />
            <span>保存账户</span>
          </button>

          <div className="search-line">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="代码或名称" />
            <button disabled={searching} onClick={() => void searchStock()} type="button" title="检索">
              <Search size={16} />
            </button>
          </div>
          {results.length > 0 ? (
            <div className="search-results">
              {results.map((item) => (
                <button
                  key={`${item.source}-${item.symbol}`}
                  onClick={() => {
                    setForm({
                      ...form,
                      symbol: item.symbol,
                      name: item.name,
                      costPrice: form.costPrice || item.price
                    });
                  }}
                  type="button"
                >
                  <strong>{item.name}</strong>
                  <span>
                    {item.symbol} · {item.price}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <label>
            代码
            <input value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })} />
          </label>
          <label>
            名称
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            数量
            <input value={form.quantity || ""} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} />
          </label>
          <label>
            成本
            <input value={form.costPrice || ""} onChange={(event) => setForm({ ...form, costPrice: Number(event.target.value) })} />
          </label>
          <label>
            备注
            <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          </label>

          <div className="editor-actions">
            <button className="icon-text-button" disabled={saving || !form.symbol} onClick={() => void saveHolding()} type="button">
              <Save size={16} />
              <span>保存</span>
            </button>
            <button className="icon-text-button danger" disabled={saving || !form.symbol} onClick={() => void saveHolding(0)} type="button">
              <Trash2 size={16} />
              <span>清仓</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
