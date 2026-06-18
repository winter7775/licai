import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PortfolioState } from "../src/domain/portfolio";

export const DEFAULT_PORTFOLIO: PortfolioState = {
  accountEquity: 357_000,
  cash: 145_000,
  holdings: [
    {
      symbol: "600879",
      name: "航天电子",
      quantity: 4300,
      costPrice: 24.16,
      note: "成熟仓，来自既有持仓记录",
      updatedAt: "2026-06-06T00:00:00.000Z"
    },
    {
      symbol: "600036",
      name: "招商银行",
      quantity: 400,
      costPrice: 38.8,
      note: "试仓，来自既有持仓记录",
      updatedAt: "2026-06-06T00:00:00.000Z"
    },
    {
      symbol: "518880",
      name: "黄金ETF华安",
      quantity: 15300,
      costPrice: 9.5694,
      note: "建仓中，来自既有持仓记录",
      updatedAt: "2026-06-06T00:00:00.000Z"
    }
  ]
};

function normalizePortfolio(input: Partial<PortfolioState>): PortfolioState {
  return {
    accountEquity: Number(input.accountEquity) || DEFAULT_PORTFOLIO.accountEquity,
    cash: Number(input.cash) || 0,
    holdings: Array.isArray(input.holdings)
      ? input.holdings.map((holding) => ({
          symbol: String(holding.symbol ?? "").padStart(6, "0").slice(-6),
          name: String(holding.name ?? ""),
          quantity: Number(holding.quantity) || 0,
          costPrice: Number(holding.costPrice) || 0,
          note: String(holding.note ?? ""),
          updatedAt: String(holding.updatedAt ?? new Date().toISOString())
        }))
      : []
  };
}

export async function readPortfolioDb(filePath: string): Promise<PortfolioState> {
  try {
    const text = await readFile(filePath, "utf-8");
    return normalizePortfolio(JSON.parse(text) as Partial<PortfolioState>);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : "";
    if (code !== "ENOENT") throw error;
    await writePortfolioDb(filePath, DEFAULT_PORTFOLIO);
    return DEFAULT_PORTFOLIO;
  }
}

export async function writePortfolioDb(filePath: string, portfolio: PortfolioState): Promise<PortfolioState> {
  const normalized = normalizePortfolio(portfolio);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  return normalized;
}
