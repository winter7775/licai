import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMarketCycleWorkspace } from "./marketCycleWorkspace";

function existsFor(paths: string[]) {
  const existing = new Set(paths.map((item) => path.resolve(item)));
  return (item: string) => existing.has(path.resolve(item));
}

describe("market cycle workspace resolver", () => {
  it("uses an explicit research workspace when SHOUZHUO_MARKET_ROOT points at quant/signals", () => {
    const appDir = path.resolve("tmp/cloud/trading-system");
    const researchRoot = path.resolve("tmp/shouzhuo-research");

    const workspace = resolveMarketCycleWorkspace({
      appDir,
      env: { SHOUZHUO_MARKET_ROOT: researchRoot },
      existsSync: existsFor([path.join(researchRoot, "quant/signals")])
    });

    expect(workspace.rootDir).toBe(researchRoot);
    expect(workspace.source).toBe("env");
    expect(workspace.signalsDir).toBe(path.join(researchRoot, "quant/signals"));
  });

  it("keeps the local monorepo layout working when apps/trading-system sits inside the research workspace", () => {
    const appDir = path.resolve("tmp/shouzhuo/apps/trading-system");
    const researchRoot = path.resolve(appDir, "../..");

    const workspace = resolveMarketCycleWorkspace({
      appDir,
      env: {},
      existsSync: existsFor([path.join(researchRoot, "quant/signals")])
    });

    expect(workspace.rootDir).toBe(researchRoot);
    expect(workspace.source).toBe("monorepo");
  });

  it("falls back to the git-tracked cloud snapshot when the server only cloned the trading-system repo", () => {
    const appDir = path.resolve("tmp/cloud/trading-system");
    const snapshotRoot = path.join(appDir, "data/market-cycle");

    const workspace = resolveMarketCycleWorkspace({
      appDir,
      env: {},
      existsSync: existsFor([path.join(snapshotRoot, "quant/signals")])
    });

    expect(workspace.rootDir).toBe(snapshotRoot);
    expect(workspace.source).toBe("snapshot");
  });

  it("returns the app directory with a warning when no market cycle workspace is available", () => {
    const appDir = path.resolve("tmp/cloud/trading-system");

    const workspace = resolveMarketCycleWorkspace({
      appDir,
      env: {},
      existsSync: existsFor([])
    });

    expect(workspace.rootDir).toBe(appDir);
    expect(workspace.source).toBe("missing");
    expect(workspace.warnings[0]).toContain("market cycle workspace");
  });
});
