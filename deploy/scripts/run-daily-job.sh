#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mingyuan/trading-system}"

cd "$APP_DIR"

set -a
if [ -f .env ]; then
  . ./.env
fi
set +a

/usr/bin/npm run job:daily
