#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mingyuan/trading-system}"
CRON_MARKER="# mingyuan-trading-daily-job"
CRON_LINE="10 17 * * 1-5 cd $APP_DIR && /usr/bin/npm run job:daily >> output/logs/cron-daily-job.log 2>&1 $CRON_MARKER"

sudo timedatectl set-timezone Asia/Shanghai
mkdir -p "$APP_DIR/output/logs"

current_cron="$(crontab -l 2>/dev/null || true)"
next_cron="$(printf "%s\n" "$current_cron" | grep -v "$CRON_MARKER" || true)"
printf "%s\n%s\n" "$next_cron" "$CRON_LINE" | sed '/^$/d' | crontab -

echo "Installed cron:"
crontab -l | grep "$CRON_MARKER"
