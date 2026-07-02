import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInitialPaperAccount, type PaperAccount } from "../src/domain/paperTrading";

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizePaperAccount(input: Partial<PaperAccount>): PaperAccount {
  const fallback = createInitialPaperAccount();
  return {
    initialCapital: Number(input.initialCapital) || fallback.initialCapital,
    cash: Number(input.cash) || 0,
    holdings: Array.isArray(input.holdings)
      ? input.holdings.map((holding) => ({
          symbol: String(holding.symbol ?? "").padStart(6, "0").slice(-6),
          name: String(holding.name ?? ""),
          industry: String(holding.industry ?? "未分类"),
          quantity: Number(holding.quantity) || 0,
          avgCost: Number(holding.avgCost) || 0,
          initialStopPrice: optionalNumber(holding.initialStopPrice),
          stopPrice: Number(holding.stopPrice) || 0,
          profitStopPrice: optionalNumber(holding.profitStopPrice),
          atrStopPrice: optionalNumber(holding.atrStopPrice),
          highestPriceSinceEntry: optionalNumber(holding.highestPriceSinceEntry),
          profitProtectionStage: holding.profitProtectionStage,
          protectedProfitPct: optionalNumber(holding.protectedProfitPct),
          takeProfitPrice: Number(holding.takeProfitPrice) || 0,
          openedAt: String(holding.openedAt ?? fallback.updatedAt),
          updatedAt: String(holding.updatedAt ?? fallback.updatedAt),
          reason: String(holding.reason ?? "")
        }))
      : [],
    trades: Array.isArray(input.trades)
      ? input.trades.map((trade) => ({
          id: String(trade.id ?? ""),
          side: trade.side === "sell" ? "sell" : "buy",
          symbol: String(trade.symbol ?? "").padStart(6, "0").slice(-6),
          name: String(trade.name ?? ""),
          industry: String(trade.industry ?? "未分类"),
          quantity: Number(trade.quantity) || 0,
          price: Number(trade.price) || 0,
          stopPrice: trade.stopPrice === undefined ? undefined : Number(trade.stopPrice),
          takeProfitPrice: trade.takeProfitPrice === undefined ? undefined : Number(trade.takeProfitPrice),
          amount: Number(trade.amount) || 0,
          realizedPnl: trade.realizedPnl === undefined ? undefined : Number(trade.realizedPnl),
          realizedPnlPct: trade.realizedPnlPct === undefined ? undefined : Number(trade.realizedPnlPct),
          reason: String(trade.reason ?? ""),
          tradedAt: String(trade.tradedAt ?? fallback.updatedAt)
        }))
      : [],
    reviews: Array.isArray(input.reviews)
      ? input.reviews.map((review) => ({
          id: String(review.id ?? ""),
          date: String(review.date ?? ""),
          actionSummary: String(review.actionSummary ?? ""),
          marketGate: String(review.marketGate ?? ""),
          targetExposurePct: Number(review.targetExposurePct) || 0,
          decisions: Array.isArray(review.decisions) ? review.decisions.map(String) : [],
          createdAt: String(review.createdAt ?? fallback.updatedAt)
        }))
      : [],
    updatedAt: String(input.updatedAt ?? fallback.updatedAt)
  };
}

export async function readPaperTradingDb(filePath: string): Promise<PaperAccount> {
  try {
    const text = await readFile(filePath, "utf-8");
    return normalizePaperAccount(JSON.parse(text) as Partial<PaperAccount>);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : "";
    if (code !== "ENOENT") throw error;
    const initial = createInitialPaperAccount();
    await writePaperTradingDb(filePath, initial);
    return initial;
  }
}

export async function writePaperTradingDb(filePath: string, account: PaperAccount): Promise<PaperAccount> {
  const normalized = normalizePaperAccount(account);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  return normalized;
}
