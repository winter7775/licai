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
curl -fsSL https://raw.githubusercontent.com/winter7775/mingyuan/main/deploy/scripts/bootstrap-ubuntu.sh | bash
```

Manual path:

```bash
sudo mkdir -p /opt/mingyuan
sudo chown -R "$USER":"$USER" /opt/mingyuan
cd /opt/mingyuan
git clone https://github.com/winter7775/mingyuan.git trading-system
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
npm run job:daily
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

Install the cron example:

```bash
crontab -e
```

Paste the line from `deploy/cron/mingyuan-daily-job.example`.

The recommended first schedule is Monday to Friday at `17:10` China time.

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
