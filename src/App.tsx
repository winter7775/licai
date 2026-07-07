import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, type PageKey } from "./components/AppShell";
import { Dashboard } from "./components/Dashboard";
import { DataHealthPage } from "./components/DataHealthPage";
import { ParamsPage } from "./components/ParamsPage";
import { PaperTradingPage } from "./components/PaperTradingPage";
import { PortfolioPage } from "./components/PortfolioPage";
import { PositionControlPage } from "./components/PositionControlPage";
import { RuleInspector } from "./components/RuleInspector";
import { SignalTable } from "./components/SignalTable";
import { LiveDataToolbar } from "./components/LiveDataToolbar";
import { getDataHealth, getPositionStatus, getSignals } from "./data/apiClient";
import type { PortfolioHolding, PortfolioState } from "./domain/portfolio";
import type { SignalCandidate } from "./domain/types";
import {
  fetchLiveScan,
  fetchPaperTrading,
  fetchPositionStatus,
  mapLiveScanSignals,
  runPaperTrading,
  runPaperTradingScanBatch
} from "./live/liveAdapter";
import type { LiveUiState, PaperTradingResponseDto, PortfolioResponseDto, PositionStatusResponseDto, ScanDepth } from "./live/liveTypes";

const SCAN_DEPTH_HISTORY_LIMIT: Record<ScanDepth, number> = {
  quick: 20,
  standard: 80,
  deep: 160
};

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const demoSignals = useMemo(() => getSignals(), []);
  const [allSignals, setAllSignals] = useState<SignalCandidate[]>(demoSignals);
  const watchlist = useMemo(
    () => allSignals.filter((signal) => signal.signalType === "watch" || signal.tradability === "观察"),
    [allSignals]
  );
  const [selectedSignal, setSelectedSignal] = useState<SignalCandidate>(demoSignals[0]);
  const [liveState, setLiveState] = useState<LiveUiState>({ status: "loading", scan: null, error: null });
  const [scanDepth, setScanDepth] = useState<ScanDepth>("quick");
  const [position, setPosition] = useState(getPositionStatus());
  const [positionSource, setPositionSource] = useState<PositionStatusResponseDto["source"] | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponseDto | null>(null);
  const [paperTrading, setPaperTrading] = useState<PaperTradingResponseDto | null>(null);
  const [positionRefreshing, setPositionRefreshing] = useState(false);
  const [paperRefreshing, setPaperRefreshing] = useState(false);
  const hasStarted = useRef(false);
  const health = getDataHealth();

  const applySignals = useCallback(
    (signals: SignalCandidate[]) => {
      const nextSignals = signals.length > 0 ? signals : demoSignals;
      setAllSignals(nextSignals);
      setSelectedSignal((current) => nextSignals.find((signal) => signal.id === current.id) ?? nextSignals[0] ?? demoSignals[0]);
    },
    [demoSignals]
  );

  const refreshPositionData = useCallback(async (force = false) => {
    setPositionRefreshing(true);
    try {
      const response = await fetchPositionStatus(force);
      setPosition(response.status);
      setPositionSource(response.source);
      setPortfolio(response.portfolio);
      return response.status;
    } finally {
      setPositionRefreshing(false);
    }
  }, []);

  const refreshLiveData = useCallback(
    async (force = false, depth: ScanDepth = scanDepth) => {
      setLiveState((current) => ({ status: "loading", scan: current.scan, error: null }));
      try {
        const scan = await fetchLiveScan({ force, historyLimit: SCAN_DEPTH_HISTORY_LIMIT[depth] });
        applySignals(mapLiveScanSignals(scan, position));
        setLiveState({ status: "live", scan, error: null });
      } catch (error) {
        applySignals(demoSignals);
        setLiveState({
          status: "fallback",
          scan: null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    },
    [applySignals, demoSignals, position, scanDepth]
  );

  const refreshPaperTrading = useCallback(async () => {
    setPaperRefreshing(true);
    try {
      setPaperTrading(await fetchPaperTrading());
    } finally {
      setPaperRefreshing(false);
    }
  }, []);

  const runPaperTradingCycle = useCallback(async () => {
    setPaperRefreshing(true);
    try {
      setPaperTrading(await runPaperTrading(true));
    } finally {
      setPaperRefreshing(false);
    }
  }, []);

  const runPaperScanBatch = useCallback(async () => {
    setPaperRefreshing(true);
    try {
      for (let batch = 0; batch < 10; batch += 1) {
        const response = await runPaperTradingScanBatch({ batchSize: 40 });
        setPaperTrading(response);
        if (response.scanState?.status === "complete" || response.scanState?.status === "error") break;
      }
    } finally {
      setPaperRefreshing(false);
    }
  }, []);

  const changeScanDepth = useCallback(
    (nextDepth: ScanDepth) => {
      setScanDepth(nextDepth);
      void refreshLiveData(true, nextDepth);
    },
    [refreshLiveData]
  );

  async function saveHolding(holding: PortfolioHolding) {
    const response = await fetch("/api/portfolio/holding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(holding)
    });
    if (!response.ok) throw new Error("持仓保存失败");
    setPortfolio((await response.json()) as PortfolioResponseDto);
    await refreshPositionData(false);
  }

  async function savePortfolio(nextPortfolio: PortfolioState) {
    const response = await fetch("/api/portfolio", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextPortfolio)
    });
    if (!response.ok) throw new Error("账户保存失败");
    setPortfolio((await response.json()) as PortfolioResponseDto);
    await refreshPositionData(false);
  }

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    void refreshPositionData(true);
    void refreshLiveData(false);
    void refreshPaperTrading();
  }, [refreshLiveData, refreshPaperTrading, refreshPositionData]);

  useEffect(() => {
    if (!liveState.scan) return;
    applySignals(mapLiveScanSignals(liveState.scan, position));
  }, [applySignals, liveState.scan, position]);

  function renderPage() {
    if (activePage === "dashboard") {
      return (
        <Dashboard
          signals={allSignals}
          selectedSignal={selectedSignal}
          onSelectSignal={setSelectedSignal}
          onOpenPage={setActivePage}
          liveState={liveState}
          position={position}
        />
      );
    }

    if (activePage === "signals") {
      return (
        <div className="content-grid">
          <SignalTable signals={allSignals} selectedId={selectedSignal.id} onSelect={setSelectedSignal} />
          <RuleInspector signal={selectedSignal} />
        </div>
      );
    }

    if (activePage === "watchlist") {
      return (
        <div className="content-grid">
          <SignalTable signals={watchlist} selectedId={selectedSignal.id} onSelect={setSelectedSignal} />
          <RuleInspector signal={selectedSignal} />
        </div>
      );
    }

    if (activePage === "stock") {
      return (
        <div className="stock-layout">
          <section className="panel stock-canvas">
            <div className="panel-heading">
              <div>
                <h2>{selectedSignal.name}</h2>
                <p>
                  {selectedSignal.symbol} · {selectedSignal.industry} · {selectedSignal.signalLabel}
                </p>
              </div>
              <span>{selectedSignal.tradability}</span>
            </div>
            <div className="kline-placeholder">
              {selectedSignal.sparkline.map((value, index) => (
                <i
                  key={`${selectedSignal.id}-${index}`}
                  style={{
                    height: `${24 + ((value - Math.min(...selectedSignal.sparkline)) / Math.max(Math.max(...selectedSignal.sparkline) - Math.min(...selectedSignal.sparkline), 1)) * 132}px`
                  }}
                />
              ))}
              <div className="price-line pivot">Pivot {selectedSignal.pivotPrice.toFixed(2)}</div>
              <div className="price-line stop">Stop {selectedSignal.stopPrice.toFixed(2)}</div>
            </div>
          </section>
          <RuleInspector signal={selectedSignal} />
        </div>
      );
    }

    if (activePage === "portfolio") {
      return (
        <PortfolioPage
          portfolio={portfolio}
          loading={positionRefreshing}
          onRefresh={() => void refreshPositionData(false)}
          onSaveHolding={saveHolding}
          onSavePortfolio={savePortfolio}
        />
      );
    }

    if (activePage === "paper") {
      return (
        <PaperTradingPage
          paperTrading={paperTrading}
          positionSource={positionSource}
          loading={paperRefreshing}
          onRefresh={() => void refreshPaperTrading()}
          onRun={() => void runPaperTradingCycle()}
          onRunScanBatch={() => void runPaperScanBatch()}
        />
      );
    }

    if (activePage === "position") {
      return (
        <PositionControlPage
          position={position}
          source={positionSource}
          onRefresh={() => void refreshPositionData(true)}
          refreshing={positionRefreshing}
        />
      );
    }

    if (activePage === "params") return <ParamsPage />;
    return <DataHealthPage liveState={liveState} position={position} positionSource={positionSource} />;
  }

  return (
    <AppShell
      activePage={activePage}
      onPageChange={setActivePage}
      tradeDate={liveState.scan?.tradeDate || position.cycle.targetDate}
      dataMode={liveState.status === "live" ? "现网 A 股行情" : health.mode}
      gateLabel={position.finalGate.label}
    >
      <LiveDataToolbar
        state={liveState}
        scanDepth={scanDepth}
        onDepthChange={changeScanDepth}
        onRefresh={() => void refreshLiveData(true)}
      />
      {renderPage()}
    </AppShell>
  );
}
