import {
  Activity,
  BarChart3,
  Bot,
  ClipboardList,
  DatabaseZap,
  Gauge,
  LineChart,
  Settings2,
  ShieldCheck,
  Target,
  WalletCards
} from "lucide-react";
import type { ReactNode } from "react";

export type PageKey = "dashboard" | "signals" | "watchlist" | "stock" | "portfolio" | "paper" | "position" | "params" | "health";

const navItems: Array<{ key: PageKey; label: string; icon: typeof Gauge }> = [
  { key: "dashboard", label: "总览", icon: Gauge },
  { key: "signals", label: "今日信号", icon: Activity },
  { key: "watchlist", label: "候选池", icon: ClipboardList },
  { key: "stock", label: "个股详情", icon: LineChart },
  { key: "portfolio", label: "持仓管理", icon: WalletCards },
  { key: "paper", label: "模拟盘", icon: Bot },
  { key: "position", label: "仓位管控", icon: ShieldCheck },
  { key: "params", label: "参数", icon: Settings2 },
  { key: "health", label: "数据健康", icon: DatabaseZap }
];

interface AppShellProps {
  activePage: PageKey;
  onPageChange: (page: PageKey) => void;
  tradeDate: string;
  dataMode: string;
  gateLabel: string;
  children: ReactNode;
}

export function AppShell({ activePage, onPageChange, tradeDate, dataMode, gateLabel, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Target size={20} />
          </div>
          <div>
            <strong>明远</strong>
            <span>交易系统</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${activePage === item.key ? "active" : ""}`}
                key={item.key}
                onClick={() => onPageChange(item.key)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <BarChart3 size={18} />
          <span>右侧中期 v0.3</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">A股右侧中期筛选</p>
            <h1>{navItems.find((item) => item.key === activePage)?.label ?? "总览"}</h1>
          </div>
          <div className="topbar-status">
            <span>{tradeDate}</span>
            <span>{dataMode}</span>
            <strong>{gateLabel}</strong>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
