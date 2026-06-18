#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mingyuan/trading-system}"
CRON_MARKER="# mingyuan-trading-daily-job"
CRON_LINE="0 15 * * 1-5 APP_DIR=$APP_DIR /bin/bash $APP_DIR/deploy/scripts/run-daily-job.sh >> $APP_DIR/output/logs/cron-daily-job.log 2>&1 $CRON_MARKER"

sudo timedatectl set-timezone Asia/Shanghai
mkdir -p "$APP_DIR/output/logs"
chmod +x "$APP_DIR/deploy/scripts/run-daily-job.sh"

current_cron="$(crontab -l 2>/dev/null || true)"
next_cron="$(printf "%s\n" "$current_cron" | grep -v "$CRON_MARKER" || true)"
printf "%s\n%s\n" "$next_cron" "$CRON_LINE" | sed '/^$/d' | crontab -

echo "Installed cron:"
crontab -l | grep "$CRON_MARKER"
