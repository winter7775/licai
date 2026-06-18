# Rich WeCom Daily Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Enterprise WeChat daily notification from a task heartbeat into a paper-trading review report.

**Architecture:** Reuse data already produced by `runPaperTradingCycle` instead of making extra quote requests. Return the pre-trade paper summary from `server/apiHandlers.ts`, extract a compact report in `server/dailyJob.ts`, and render it as markdown.

**Tech Stack:** TypeScript, Vitest, Node fetch, Enterprise WeChat markdown webhook.

---

## File Structure

- `server/apiHandlers.ts`: Include `beforeSummary` in the paper-trading run payload.
- `server/dailyJob.ts`: Build a compact paper report and richer Enterprise WeChat markdown.
- `server/dailyJob.test.ts`: Verify account overview, today PnL, holdings, and trade details are included.

## Task 1: Add Rich Daily Report Tests

- [ ] Add a failing `server/dailyJob.test.ts` case that calls `buildDailyJobMarkdown` with paper summary fields and expects account overview, today PnL, holdings, and trade details.
- [ ] Run `npm.cmd test -- --run server/dailyJob.test.ts` and confirm the test fails because the markdown does not include those fields.

## Task 2: Carry Paper Report Data Through Daily Job

- [ ] Extend `PaperRunLike` and `DailyJobSummary` in `server/dailyJob.ts` with compact paper report fields.
- [ ] Add extraction helpers that calculate `dailyPnl` from `run.beforeSummary.totalAssets` and `summary.totalAssets`.
- [ ] Update `buildDailyJobMarkdown` to render overview, holdings, trades, and quote warnings.
- [ ] Run `npm.cmd test -- --run server/dailyJob.test.ts` and confirm it passes.

## Task 3: Expose Before Summary From Paper Trading Cycle

- [ ] Modify `server/apiHandlers.ts` so `runPaperTradingCycle` returns `run.beforeSummary`.
- [ ] Run `npm.cmd test -- --run server/dailyJob.test.ts server/apiHandlers.test.ts`.

## Task 4: Full Verification And Push

- [ ] Run `npm.cmd test -- --run`.
- [ ] Run `npm.cmd run build`.
- [ ] Commit and push to `winter7775/licai`.
