export interface PortfolioHolding {
  symbol: string;
  name: string;
  quantity: number;
  costPrice: number;
  note: string;
  updatedAt: string;
}

export interface PortfolioState {
  accountEquity: number;
  cash: number;
  holdings: PortfolioHolding[];
}

export interface HoldingQuote {
  price: number;
  name: string;
  industry: string;
}

export interface EnrichedHolding extends PortfolioHolding {
  currentPrice: number;
  marketValue: number;
  costValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  weightPct: number;
  industry: string;
}

export interface PortfolioSummary {
  accountEquity: number;
  cash: number;
  marketValue: number;
  totalCost: number;
  unrealizedPnl: number;
  exposurePct: number;
  singleNameMaxPct: number;
  holdings: EnrichedHolding[];
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function normalizedSymbol(symbol: string): string {
  return symbol.trim().padStart(6, "0").slice(-6);
}

export function upsertHolding(portfolio: PortfolioState, holding: PortfolioHolding): PortfolioState {
  const symbol = normalizedSymbol(holding.symbol);
  const nextHoldings = portfolio.holdings.filter((item) => normalizedSymbol(item.symbol) !== symbol);

  if (holding.quantity > 0) {
    nextHoldings.push({
      ...holding,
      symbol,
      quantity: Number(holding.quantity),
      costPrice: Number(holding.costPrice)
    });
  }

  return {
    ...portfolio,
    accountEquity: Number(portfolio.accountEquity) || 0,
    cash: Number(portfolio.cash) || 0,
    holdings: nextHoldings.sort((left, right) => left.symbol.localeCompare(right.symbol))
  };
}

export function calculatePortfolioSummary(
  portfolio: PortfolioState,
  quotes: Record<string, HoldingQuote> = {}
): PortfolioSummary {
  const holdings = portfolio.holdings.map((holding) => {
    const quote = quotes[normalizedSymbol(holding.symbol)];
    const currentPrice = quote?.price && quote.price > 0 ? quote.price : holding.costPrice;
    const marketValue = holding.quantity * currentPrice;
    const costValue = holding.quantity * holding.costPrice;
    const unrealizedPnl = marketValue - costValue;
    const denominator = costValue > 0 ? costValue : 1;

    return {
      ...holding,
      name: quote?.name || holding.name,
      currentPrice: round(currentPrice),
      marketValue: round(marketValue),
      costValue: round(costValue),
      unrealizedPnl: round(unrealizedPnl),
      unrealizedPnlPct: round((unrealizedPnl / denominator) * 100),
      weightPct: 0,
      industry: quote?.industry || "未分类"
    };
  });
  const marketValue = holdings.reduce((sum, item) => sum + item.marketValue, 0);
  const accountEquity = portfolio.accountEquity > 0 ? portfolio.accountEquity : marketValue + portfolio.cash;
  const enriched = holdings.map((holding) => ({
    ...holding,
    weightPct: accountEquity > 0 ? round((holding.marketValue / accountEquity) * 100) : 0
  }));

  return {
    accountEquity: round(accountEquity),
    cash: round(portfolio.cash),
    marketValue: round(marketValue),
    totalCost: round(enriched.reduce((sum, item) => sum + item.costValue, 0)),
    unrealizedPnl: round(enriched.reduce((sum, item) => sum + item.unrealizedPnl, 0)),
    exposurePct: accountEquity > 0 ? round((marketValue / accountEquity) * 100) : 0,
    singleNameMaxPct: enriched.length > 0 ? Math.max(...enriched.map((item) => item.weightPct)) : 0,
    holdings: enriched
  };
}
