# Cloud Auto-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production Node backend and daily auto-run job so the trading system can run on one Tencent Cloud Linux server without the user's personal computer.

**Architecture:** Extract the existing Vite middleware API into shared handlers, then reuse those handlers from both Vite dev mode and a standalone Node HTTP server. Add a daily job module that runs background scan batches and paper trading using the same domain/service functions as the API.

**Tech Stack:** TypeScript, React, Vite, Node.js HTTP server, Vitest, local JSON files under `data/`.

---

## File Structure

- `server/apiHandlers.ts`: Shared API routing and exported service functions. Owns `/api/live/*`, `/api/portfolio/*`, `/api/paper-trading/*`.
- `server/liveApiPlugin.ts`: Thin Vite adapter that delegates requests to `handleApiRequest`.
- `server/appServer.ts`: Production HTTP server serving `dist/` and API routes.
- `server/dailyJob.ts`: Daily scan and paper-trading command.
- `server/apiHandlers.test.ts`: Tests shared handler behavior.
- `server/appServer.test.ts`: Tests static/fallback behavior helpers where possible.
- `server/dailyJob.test.ts`: Tests job orchestration without hitting live APIs.
- `deploy/README.md`: Tencent Cloud deployment checklist.
- `deploy/systemd/mingyuan-trading.service.example`: Backend service example.
- `deploy/cron/mingyuan-daily-job.example`: Cron example.
- `deploy/nginx/mingyuan-trading.conf.example`: Optional reverse proxy example.
- `package.json`: Add `start`, `job:daily`, and build support scripts.

## Task 1: Extract Shared API Handlers

**Files:**
- Create: `server/apiHandlers.ts`
- Modify: `server/liveApiPlugin.ts`
- Test: `server/apiHandlers.test.ts`
- Test: `server/liveApiPlugin.test.ts`

- [ ] **Step 1: Write failing shared-handler test**

Add `server/apiHandlers.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { handleApiRequest } from "./apiHandlers";

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    end(value: string) {
      this.body = value;
    }
  };
}

describe("shared api handlers", () => {
  it("returns false for non-api routes", async () => {
    const response = createMockResponse();

    const handled = await handleApiRequest({ method: "GET", url: "/" }, response, new URL("http://127.0.0.1/"));

    expect(handled).toBe(false);
    expect(response.body).toBe("");
  });

  it("serves live health with json headers", async () => {
    const response = createMockResponse();

    const handled = await handleApiRequest(
      { method: "GET", url: "/api/live/health" },
      response,
      new URL("http://127.0.0.1/api/live/health")
    );

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(response.body)).toMatchObject({
      provider: "eastmoney-public",
      ready: true
    });
  });
});
```

- [ ] **Step 2: Run red test**

Run: `npm.cmd test -- --run server/apiHandlers.test.ts`

Expected: fail because `server/apiHandlers.ts` does not exist.

- [ ] **Step 3: Move API logic into shared file**

Create `server/apiHandlers.ts` by moving the existing constants, helper functions, route handlers, and service functions out of `server/liveApiPlugin.ts`. Export:

```ts
export async function handleApiRequest(request: any, response: any, requestUrl: URL): Promise<boolean>;
export async function runPaperTradingCycle(options?: { force?: boolean }): Promise<unknown>;
export async function resetPaperBackgroundScan(): Promise<unknown>;
export async function runPaperBackgroundScanStep(requestUrl: URL): Promise<unknown>;
```

Keep behavior unchanged. `handleApiRequest` should call paper trading, portfolio, and live route handlers in the same order as the current Vite plugin.

- [ ] **Step 4: Make Vite plugin a thin adapter**

Replace `server/liveApiPlugin.ts` with:

```ts
import type { Plugin } from "vite";
import { handleApiRequest } from "./apiHandlers";

export function liveApiPlugin(): Plugin {
  const install = (server: any) => {
    server.middlewares.use(async (request: any, response: any, next: () => void) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (await handleApiRequest(request, response, requestUrl)) return;
      next();
    });
  };

  return {
    name: "mingyuan-live-a-share-api",
    configureServer: install,
    configurePreviewServer: install
  };
}
```

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd test -- --run server/apiHandlers.test.ts server/liveApiPlugin.test.ts`

Expected: pass.

## Task 2: Add Production HTTP Server

**Files:**
- Create: `server/appServer.ts`
- Test: `server/appServer.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing server helper test**

Add `server/appServer.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { contentTypeForPath, shouldServeIndexHtml } from "./appServer";

describe("production app server helpers", () => {
  it("uses index fallback for non-api extensionless routes", () => {
    expect(shouldServeIndexHtml("/")).toBe(true);
    expect(shouldServeIndexHtml("/paper")).toBe(true);
    expect(shouldServeIndexHtml("/api/live/health")).toBe(false);
    expect(shouldServeIndexHtml("/assets/index.js")).toBe(false);
  });

  it("returns stable content types for built assets", () => {
    expect(contentTypeForPath("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeForPath("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeForPath("style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeForPath("data.json")).toBe("application/json; charset=utf-8");
  });
});
```

- [ ] **Step 2: Run red test**

Run: `npm.cmd test -- --run server/appServer.test.ts`

Expected: fail because `server/appServer.ts` does not exist.

- [ ] **Step 3: Implement production server**

Create `server/appServer.ts` with exported helper functions and a Node HTTP server. It should:

- Use `createServer` from `node:http`.
- Delegate `/api/...` to `handleApiRequest`.
- Serve files from `dist/`.
- Serve `dist/index.html` for extensionless non-API routes.
- Listen on `process.env.PORT || 4173` only when executed directly.

- [ ] **Step 4: Add package scripts**

Modify `package.json` scripts:

```json
"start": "tsx server/appServer.ts",
"job:daily": "tsx server/dailyJob.ts"
```

Also add `tsx` to `devDependencies` so TypeScript server entries can run directly on the VPS.

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd test -- --run server/appServer.test.ts`

Expected: pass.

## Task 3: Add Daily Auto-Run Job

**Files:**
- Create: `server/dailyJob.ts`
- Test: `server/dailyJob.test.ts`

- [ ] **Step 1: Write failing orchestration test**

Add `server/dailyJob.test.ts` with dependency injection:

```ts
import { describe, expect, it } from "vitest";
import { runDailyJob } from "./dailyJob";

describe("daily cloud job", () => {
  it("runs scan batches until complete then runs paper trading", async () => {
    const calls: string[] = [];
    let step = 0;

    const result = await runDailyJob({
      now: new Date("2026-06-18T17:10:00+08:00"),
      maxBatches: 3,
      resetScan: async () => {
        calls.push("reset");
        return { scanState: { status: "running", analyzedCount: 0, cursor: 0 } };
      },
      scanStep: async () => {
        calls.push("scan");
        step += 1;
        return { scanState: { status: step >= 2 ? "complete" : "running", analyzedCount: step * 40, cursor: step * 40 } };
      },
      runPaper: async () => {
        calls.push("paper");
        return { run: { trades: [{ symbol: "600000" }] }, summary: { exposurePct: 3 } };
      },
      writeLog: async () => {
        calls.push("log");
      }
    });

    expect(calls).toEqual(["reset", "scan", "scan", "paper", "log"]);
    expect(result.scanCompleted).toBe(true);
    expect(result.paperRan).toBe(true);
    expect(result.tradeCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run red test**

Run: `npm.cmd test -- --run server/dailyJob.test.ts`

Expected: fail because `server/dailyJob.ts` does not exist.

- [ ] **Step 3: Implement job orchestration**

Create `server/dailyJob.ts` with:

```ts
export interface DailyJobDeps { ... }
export async function runDailyJob(deps?: Partial<DailyJobDeps>): Promise<DailyJobSummary>;
```

Default dependencies should call `resetPaperBackgroundScan`, `runPaperBackgroundScanStep`, and `runPaperTradingCycle({ force: true })` from `apiHandlers`.

Write logs to:

- `output/logs/daily-job-YYYY-MM-DD.json`
- `output/logs/daily-job-YYYY-MM-DD.txt`

- [ ] **Step 4: Run focused tests**

Run: `npm.cmd test -- --run server/dailyJob.test.ts`

Expected: pass.

## Task 4: Add Deployment Documentation

**Files:**
- Create: `deploy/README.md`
- Create: `deploy/systemd/mingyuan-trading.service.example`
- Create: `deploy/cron/mingyuan-daily-job.example`
- Create: `deploy/nginx/mingyuan-trading.conf.example`

- [ ] **Step 1: Add Tencent Cloud checklist**

Create `deploy/README.md` with commands:

```bash
npm ci
npm run build
npm run start
npm run job:daily
```

Document Node 20+, port `4173`, data backup, systemd, cron, and optional Nginx basic auth.

- [ ] **Step 2: Add service examples**

Create examples using `/opt/mingyuan/trading-system` as the deployment path and `Asia/Shanghai` cron timing.

- [ ] **Step 3: Validate docs are present**

Run: `Get-ChildItem -Recurse deploy`

Expected: all four files exist.

## Task 5: Full Verification

**Files:**
- No new files.

- [ ] Run: `npm.cmd test -- --run`

Expected: all tests pass.

- [ ] Run: `npm.cmd run build`

Expected: TypeScript and Vite build pass.

- [ ] Run production server locally:

```powershell
Start-Process -WindowStyle Hidden -FilePath npm.cmd -ArgumentList "run","start" -WorkingDirectory "D:\agent\守拙_金融助理\apps\trading-system"
```

Open `http://127.0.0.1:4173/` and verify the page loads.

- [ ] Run: `npm.cmd run job:daily`

Expected: job writes files under `output/logs/` and does not crash.

- [ ] Record verification results in the final response.
