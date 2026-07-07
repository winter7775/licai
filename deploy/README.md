# Mingyuan Trading System Cloud Deployment

This guide targets one Tencent Cloud lightweight Linux server.

## Server Baseline

- OS: Ubuntu 22.04 or 24.04
- Node.js: 20+
- App path used by examples: `/opt/mingyuan/trading-system`
- Default app port: `4173`
- Time zone: `Asia/Shanghai`

## First Deploy

Fast path:

```bash
curl -fsSL https://raw.githubusercontent.com/winter7775/licai/main/deploy/scripts/bootstrap-ubuntu.sh | bash
cd /opt/mingyuan/trading-system
bash deploy/scripts/install-cron.sh
bash deploy/scripts/run-daily-job.sh
```

Manual path:

```bash
sudo mkdir -p /opt/mingyuan
sudo chown -R "$USER":"$USER" /opt/mingyuan
cd /opt/mingyuan
git clone https://github.com/winter7775/licai.git trading-system
cd trading-system
npm ci
npm run build
npm run start
```

Open:

```text
http://SERVER_IP:4173/
```

## Daily Job Test

Run once manually after the first deploy:

```bash
cd /opt/mingyuan/trading-system
bash deploy/scripts/run-daily-job.sh
```

Expected outputs:

- `data/paper-trading.json`
- `data/paper-scan-state.json`
- `output/logs/daily-job-YYYY-MM-DD.json`
- `output/logs/daily-job-YYYY-MM-DD.txt`

## Data Backup Before Updates

```bash
cd /opt/mingyuan/trading-system
mkdir -p backups
cp -r data "backups/data-$(date +%Y%m%d-%H%M%S)"
```

Then update:

```bash
git pull
npm ci
npm run build
sudo systemctl restart mingyuan-trading
```

## Market Cycle Data Source

The cloud app reads market-cycle and position-gate data in this order:

1. `SHOUZHUO_MARKET_ROOT` if it points to a full Shouzhuo research workspace containing `quant/signals`.
2. The local monorepo layout, where this app lives under `守拙_金融助理/apps/trading-system`.
3. The git-tracked lightweight snapshot at `data/market-cycle/quant/signals`.

For the current Tencent Cloud deployment, `git pull` is enough to receive the
lightweight snapshot committed in this repo. It lets the web app and paper-trading
job avoid the conservative cloud fallback even when the full research workspace is
not installed on the server.

If you later copy the full research workspace to the server, configure the service:

```bash
sudo systemctl edit mingyuan-trading
```

Paste:

```ini
[Service]
Environment=SHOUZHUO_MARKET_ROOT=/opt/mingyuan/shouzhuo-research
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart mingyuan-trading
```

When the full workspace is not configured, clicking a forced market-cycle refresh
will keep using the latest snapshot and report a warning instead of silently reading
the wrong directory.

## systemd Service

Copy the example:

```bash
sudo cp deploy/systemd/mingyuan-trading.service.example /etc/systemd/system/mingyuan-trading.service
sudo systemctl daemon-reload
sudo systemctl enable mingyuan-trading
sudo systemctl start mingyuan-trading
sudo systemctl status mingyuan-trading
```

Logs:

```bash
journalctl -u mingyuan-trading -f
```

## cron Daily Job

Install with the helper:

```bash
cd /opt/mingyuan/trading-system
bash deploy/scripts/install-cron.sh
```

Or install the cron example manually:

```bash
crontab -e
```

Paste the line from `deploy/cron/mingyuan-daily-job.example`.

The recommended schedule is Monday to Friday at `15:00` China time, after the A-share close.

## Enterprise WeChat Notification

Create a group bot in Enterprise WeChat and copy its webhook URL. Then save it on the server:

```bash
cd /opt/mingyuan/trading-system
cat > .env <<'EOF'
WEWORK_WEBHOOK_URL='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY'
EOF
chmod 600 .env
```

The daily job reads `.env` through `deploy/scripts/run-daily-job.sh`. If the webhook is not configured, the job still runs and only skips the message.

## Optional Nginx

Use Nginx if you want a domain name, HTTPS, or basic auth.

The app can either:

- Expose port `4173` directly for early testing.
- Bind behind Nginx using `deploy/nginx/mingyuan-trading.conf.example`.

For personal use, add HTTP basic auth before exposing the service publicly.

## Notes

- This system is for research and paper trading only.
- It does not connect to a real broker.
- Public A-share APIs can be unstable. Daily logs should be checked during the first week.
- Keep `data/` out of rebuild output and back it up before every deployment update.
