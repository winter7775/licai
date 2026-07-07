import { existsSync as nodeExistsSync } from "node:fs";
import path from "node:path";

export type MarketCycleWorkspaceSource = "env" | "monorepo" | "snapshot" | "missing";

export interface MarketCycleWorkspace {
  rootDir: string;
  signalsDir: string;
  scriptPath: string;
  source: MarketCycleWorkspaceSource;
  warnings: string[];
}

interface ResolveMarketCycleWorkspaceOptions {
  appDir: string;
  env?: Record<string, string | undefined>;
  existsSync?: (path: string) => boolean;
}

function normalizeRoot(rootDir: string): MarketCycleWorkspace {
  return {
    rootDir,
    signalsDir: path.join(rootDir, "quant/signals"),
    scriptPath: path.join(rootDir, "scripts/market_cycle_position.py"),
    source: "missing",
    warnings: []
  };
}

function withSource(workspace: MarketCycleWorkspace, source: MarketCycleWorkspaceSource): MarketCycleWorkspace {
  return { ...workspace, source };
}

function hasSignalsDir(workspace: MarketCycleWorkspace, existsSync: (path: string) => boolean): boolean {
  return existsSync(workspace.signalsDir);
}

export function resolveMarketCycleWorkspace(options: ResolveMarketCycleWorkspaceOptions): MarketCycleWorkspace {
  const env = options.env ?? process.env;
  const existsSync = options.existsSync ?? nodeExistsSync;
  const appDir = path.resolve(options.appDir);
  const envRoot = env.SHOUZHUO_MARKET_ROOT || env.SHOUZHUO_ROOT_DIR || env.MINGYUAN_RESEARCH_ROOT;

  const candidates: Array<{ source: Exclude<MarketCycleWorkspaceSource, "missing">; rootDir: string | undefined }> = [
    { source: "env", rootDir: envRoot ? path.resolve(envRoot) : undefined },
    { source: "monorepo", rootDir: path.resolve(appDir, "../..") },
    { source: "snapshot", rootDir: path.resolve(appDir, "data/market-cycle") }
  ];

  for (const candidate of candidates) {
    if (!candidate.rootDir) continue;
    const workspace = normalizeRoot(candidate.rootDir);
    if (hasSignalsDir(workspace, existsSync)) return withSource(workspace, candidate.source);
  }

  return {
    ...normalizeRoot(appDir),
    source: "missing",
    warnings: [
      `No market cycle workspace found. Set SHOUZHUO_MARKET_ROOT or provide data/market-cycle/quant/signals under ${appDir}.`
    ]
  };
}
