#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/winter7775/licai.git}"
APP_DIR="${APP_DIR:-/opt/mingyuan/trading-system}"
APP_USER="${APP_USER:-$USER}"

echo "[1/7] Set timezone"
sudo timedatectl set-timezone Asia/Shanghai

echo "[2/7] Install system packages"
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -Eq '^v2[0-9]\.'; then
  echo "[3/7] Install Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[3/7] Node.js already installed: $(node -v)"
fi

echo "[4/7] Prepare app directory"
sudo mkdir -p "$(dirname "$APP_DIR")"
sudo chown -R "$APP_USER":"$APP_USER" "$(dirname "$APP_DIR")"

if [ -d "$APP_DIR/.git" ]; then
  echo "[5/7] Update existing repo"
  git -C "$APP_DIR" pull --ff-only
else
  echo "[5/7] Clone repo"
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "[6/7] Install dependencies and build"
cd "$APP_DIR"
npm ci
npm run build
mkdir -p output/logs

echo "[7/7] Install and start systemd service"
sudo cp deploy/systemd/mingyuan-trading.service.example /etc/systemd/system/mingyuan-trading.service
sudo systemctl daemon-reload
sudo systemctl enable mingyuan-trading
sudo systemctl restart mingyuan-trading

echo
echo "Deployment complete."
echo "Open: http://SERVER_IP:4173/"
echo "Check service: sudo systemctl status mingyuan-trading"
echo "Run daily job once: cd $APP_DIR && npm run job:daily"
