# Paper Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automatic paper-trading module with 200,000 CNY virtual capital that trades from the full-market A-share screening results under the existing market-emotion and position-control rules.

**Architecture:** Keep paper trading independent from the real portfolio database. Add a domain engine for account math and auto decisions, a local JSON store for persistent paper state, API routes for run/read operations, and a new UI page to review holdings, trade ledger, and daily review notes.

**Tech Stack:** React, TypeScript, Vite middleware API, Vitest, local JSON files under `data/`.

---

### Task 1: Paper Account Domain

**Files:**
- Create: `src/domain/paperTrading.ts`
- Test: `src/domain/paperTrading.test.ts`

- [ ] Write tests for initial capital, mark-to-market summary, and buy/sell trade application.
- [ ] Implement types for paper account, holding, trade, daily review, and summary.
- [ ] Implement `createInitialPaperAccount`, `summarizePaperAccount`, and `applyPaperTrade`.
- [ ] Verify with `npm.cmd test -- src/domain/paperTrading.test.ts`.

### Task 2: Auto-Trade Decision Engine

**Files:**
- Modify: `src/domain/paperTrading.ts`
- Test: `src/domain/paperTrading.test.ts`

- [ ] Write tests proving red/blocked gates create no buys, normal gates buy only rule-qualified candidates, and exposure stays under the market-position cap.
- [ ] Implement `generatePaperTradingPlan` with these first-version rules:
  - Initial capital is 200,000 CNY.
  - Respect `PositionStatus.finalGate`: blocked/watch-only means no new buys.
  - Respect total exposure cap from `PositionStatus.band.max`.
  - Buy only candidates with non-watch signal type and no failed hard rule.
  - Single-name target is the smaller of candidate suggested position, 10%, and remaining exposure capacity.
  - Skip buys below 5,000 CNY or with invalid price.
  - Sell when price reaches stop or take-profit target.
- [ ] Verify with `npm.cmd test -- src/domain/paperTrading.test.ts`.

### Task 3: Paper Store and API

**Files:**
- Create: `server/paperTradingStore.ts`
- Create: `server/paperTradingStore.test.ts`
- Modify: `server/liveApiPlugin.ts`

- [ ] Write tests for creating `data/paper-trading.json` with 200,000 CNY and preserving existing state.
- [ ] Implement read/write helpers.
- [ ] Add `GET /api/paper-trading` to read account and summary.
- [ ] Add `POST /api/paper-trading/run` to run one automatic simulation cycle using `runLiveScreen({ force, historyLimit: 300, displayLimit: 20 })` and refreshed position status.
- [ ] Verify with `npm.cmd test -- server/paperTradingStore.test.ts server/liveApiPlugin.test.ts`.

### Task 4: Paper Trading UI

**Files:**
- Create: `src/components/PaperTradingPage.tsx`
- Modify: `src/live/liveTypes.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/styles.css`
- Test: `src/App.test.tsx`

- [ ] Add DTO types for paper account response.
- [ ] Add sidebar nav entry `模拟盘`.
- [ ] Load paper account on startup and after auto-run.
- [ ] Render total assets, cash, exposure, return, holdings, latest review, and recent trades.
- [ ] Add a button to manually run one automatic simulation cycle.
- [ ] Verify with `npm.cmd test -- src/App.test.tsx`.

### Task 5: Verification

**Files:**
- No new files.

- [ ] Run `npm.cmd test`.
- [ ] Run `npm.cmd run build`.
- [ ] Restart local dev server.
- [ ] Open `http://127.0.0.1:5173/` and verify the new page renders.
- [ ] Run `/api/paper-trading/run?refresh=1` once and confirm the response records either trades or a no-action review with clear reasons.
