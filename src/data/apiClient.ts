import { defaultStrategyParams } from "../domain/strategyParams";
import { dataHealth, marketCycleSnapshot, overview, positionStatus, retailSentimentSnapshot, signals } from "./demoData";

export function getMarketStatus() {
  return {
    overview,
    cycle: marketCycleSnapshot,
    sentiment: retailSentimentSnapshot
  };
}

export function getSignals() {
  return signals;
}

export function getWatchlist() {
  return signals.filter((signal) => signal.signalType === "watch" || signal.tradability === "观察");
}

export function getPositionStatus() {
  return positionStatus;
}

export function getDataHealth() {
  return dataHealth;
}

export function getStrategyParams() {
  return defaultStrategyParams;
}
