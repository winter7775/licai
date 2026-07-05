import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PaperQuoteSnapshot {
  updatedAt: string;
  quotes: Record<string, number>;
  previousCloses: Record<string, number>;
}

function normalizedSymbol(symbol: string): string {
  return symbol.trim().padStart(6, "0").slice(-6);
}

function positiveNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function normalizeQuoteMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([symbol, quote]) => [normalizedSymbol(symbol), positiveNumber(quote)] as const)
      .filter((item): item is readonly [string, number] => item[1] !== undefined)
  );
}

export async function readPaperQuoteSnapshot(filePath: string): Promise<PaperQuoteSnapshot | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PaperQuoteSnapshot>;
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      quotes: normalizeQuoteMap(parsed.quotes),
      previousCloses: normalizeQuoteMap(parsed.previousCloses)
    };
  } catch {
    return null;
  }
}

export async function writePaperQuoteSnapshot(filePath: string, snapshot: PaperQuoteSnapshot): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        updatedAt: snapshot.updatedAt,
        quotes: normalizeQuoteMap(snapshot.quotes),
        previousCloses: normalizeQuoteMap(snapshot.previousCloses)
      },
      null,
      2
    )}\n`,
    "utf-8"
  );
}

export function fillQuotesFromSnapshot(
  symbols: string[],
  quotes: Record<string, number>,
  previousCloses: Record<string, number>,
  snapshot: PaperQuoteSnapshot | null
): { quotes: Record<string, number>; previousCloses: Record<string, number>; filledSymbols: string[] } {
  const nextQuotes = normalizeQuoteMap(quotes);
  const nextPreviousCloses = normalizeQuoteMap(previousCloses);
  const snapshotQuotes = normalizeQuoteMap(snapshot?.quotes);
  const snapshotPreviousCloses = normalizeQuoteMap(snapshot?.previousCloses);
  const filledSymbols: string[] = [];

  for (const symbol of Array.from(new Set(symbols.map(normalizedSymbol)))) {
    if ((!nextQuotes[symbol] || nextQuotes[symbol] <= 0) && snapshotQuotes[symbol] > 0) {
      nextQuotes[symbol] = snapshotQuotes[symbol];
      filledSymbols.push(symbol);
    }
    if ((!nextPreviousCloses[symbol] || nextPreviousCloses[symbol] <= 0) && snapshotPreviousCloses[symbol] > 0) {
      nextPreviousCloses[symbol] = snapshotPreviousCloses[symbol];
    }
  }

  return { quotes: nextQuotes, previousCloses: nextPreviousCloses, filledSymbols };
}

export function buildPaperQuoteSnapshot(
  symbols: string[],
  quotes: Record<string, number>,
  previousCloses: Record<string, number>,
  updatedAt: string,
  existing: PaperQuoteSnapshot | null = null
): PaperQuoteSnapshot {
  const nextQuotes = normalizeQuoteMap(existing?.quotes);
  const nextPreviousCloses = normalizeQuoteMap(existing?.previousCloses);
  const quoteMap = normalizeQuoteMap(quotes);
  const previousCloseMap = normalizeQuoteMap(previousCloses);

  for (const symbol of Array.from(new Set(symbols.map(normalizedSymbol)))) {
    if (quoteMap[symbol] > 0) nextQuotes[symbol] = quoteMap[symbol];
    if (previousCloseMap[symbol] > 0) nextPreviousCloses[symbol] = previousCloseMap[symbol];
  }

  return {
    updatedAt,
    quotes: nextQuotes,
    previousCloses: nextPreviousCloses
  };
}
