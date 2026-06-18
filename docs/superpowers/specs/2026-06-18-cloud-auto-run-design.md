# Cloud Auto-Run Design

## Goal

Turn the current local trading-system app into a lightweight cloud deployment that can run without the user's personal computer. The user should only need to open a web page occasionally to review paper-trading holdings, scan results, market-emotion state, position guidance, and daily run logs.

## Recommended Deployment Shape

Use one Tencent Cloud lightweight Linux server for the first production-like version.

The single server will host:

- The built React frontend from `dist/`.
- A Node.js backend serving `/api/...`.
- Daily scheduled jobs for market scan and paper trading.
- JSON data files under `data/`.
- Runtime logs under `output/logs/`.

This keeps cost and operations low while the strategy is still being tuned. SQLite, Docker, database backup services, user login, and notification integrations can be added later after the system proves useful for one to two weeks.

## Architecture

```text
Tencent Cloud Linux VPS
  |- Node backend service
  |  |- serves static frontend
  |  |- handles /api/live/*
  |  |- handles /api/portfolio/*
  |  `- handles /api/paper-trading/*
  |- daily job command
  |  |- refreshes position status and market emotion
  |  |- runs / continues 400-stock background scan
  |  |- runs paper-trading cycle
  |  `- writes a dated log
  |- data/
  |  |- portfolio.json
  |  |- paper-trading.json
  |  |- paper-scan-state.json
  |  `- live-scan-cache.json
  `- output/logs/
```

## Code Changes

### Backend Service Entry

Create a production Node server entry, for example `server/appServer.ts`.

It should:

- Listen on a configurable port, defaulting to `4173`.
- Serve static files from `dist/`.
- Reuse the same API handlers currently used by the Vite plugin.
- Return `index.html` for non-API routes so page refresh works.
- Keep JSON responses UTF-8 encoded.

### API Handler Extraction

Refactor `server/liveApiPlugin.ts` so the route logic is reusable outside Vite.

Target shape:

- `server/apiHandlers.ts` owns shared API routing.
- `server/liveApiPlugin.ts` becomes a thin Vite adapter.
- `server/appServer.ts` uses the same shared API routing.

This avoids duplicating trading logic between local dev and cloud deployment.

### Daily Job Entry

Create `server/dailyJob.ts`.

The first version should:

1. Ensure `data/` and `output/logs/` exist.
2. Read the current paper scan state.
3. If the scan is missing, stale, or not complete for the current Shanghai date, start/reset it.
4. Run background scan batches until complete or a configurable max batch count is reached.
5. Run one paper-trading cycle using the latest scan state.
6. Write a dated JSON log and a concise text summary.

Default settings:

- Market-cap universe: top 30%.
- Initial pool target: 400 stocks.
- Batch size: 40.
- Max daily scan batches: 10.
- Paper trading run: once after scan completion.

### NPM Scripts

Add scripts:

- `build`: keep existing behavior.
- `start`: run production backend.
- `job:daily`: run daily scan and paper-trading job.

## Scheduling

Use Linux `cron` or a `systemd` timer.

Recommended first schedule in China time:

- Monday to Friday at `17:10`.
- The job may still run on holidays, but it should reuse the latest available trading day data if the market is closed.

Example behavior:

- If A-share APIs return today's trading data, use it.
- If not open or API data is stale, use the latest available trading day and record a warning.
- If API fails completely, do not open new simulated positions from seed/demo data.

## Process Management

Use `systemd` for the backend service in the first version.

The service should:

- Start on boot.
- Restart on failure.
- Run from the project directory.
- Use `npm run start` after `npm ci` and `npm run build`.

PM2 is acceptable too, but systemd is enough for one Node service and one scheduled job.

## Data And Backup

The first version keeps JSON persistence because the current code already uses it and the data volume is small.

Operational requirements:

- Never store generated data inside `dist/`.
- Keep `data/` outside rebuild output.
- Back up `data/` before deployment updates.
- Add a simple backup command or documentation step copying `data/` to `backups/YYYY-MM-DD-HHmm/`.

Future upgrade path:

- Move paper trading, portfolio, scan state, and logs to SQLite.
- Add migration scripts after the JSON schema stabilizes.

## Security

First version is intended for personal use.

Minimum requirements:

- Bind backend to `127.0.0.1` when using Nginx reverse proxy, or expose only one controlled port.
- Do not commit real account credentials or secrets.
- Add optional HTTP basic auth at Nginx if the server is exposed publicly.
- Keep the paper-trading module clearly separated from real brokerage execution.

Out of scope for this iteration:

- Real-money trading.
- Broker API integration.
- Multi-user accounts.
- Payment or subscription features.

## Deployment Documentation

Add `deploy/` docs and examples:

- `deploy/README.md`: Tencent Cloud setup checklist.
- `deploy/systemd/mingyuan-trading.service.example`: backend service example.
- `deploy/cron/mingyuan-daily-job.example`: daily job example.
- Optional `deploy/nginx/mingyuan-trading.conf.example`: reverse proxy example.

The docs should assume a Tencent Cloud lightweight Linux server with Node.js 20+ installed.

## Testing

Add or update tests for:

- Shared API handler can serve existing API routes outside Vite.
- Daily job calls scan steps and paper trading in the expected order.
- Daily job does not trade from seed/demo fallback data.
- Existing Vite API plugin behavior still works.

Manual verification:

- `npm test`
- `npm run build`
- `npm run start`
- Open `http://127.0.0.1:4173/`
- Run `npm run job:daily`
- Confirm `data/paper-trading.json` and `output/logs/` update.

## Acceptance Criteria

- The app can be built and started as a production Node service.
- The frontend works from the production backend without Vite dev server.
- Existing API routes work in both local dev and production server modes.
- The daily job can complete a 400-stock scan and run paper trading without browser interaction.
- The daily job writes reviewable logs.
- Deployment docs are clear enough to execute on a Tencent Cloud Linux server.
