#!/usr/bin/env bash
set -euo pipefail

TARGET_SHA="${1:-}"
APP_DIR="${APP_DIR:-/opt/mingyuan/trading-system}"
SERVICE_NAME="${SERVICE_NAME:-mingyuan-trading}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4173/api/live/health}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
NPM_BIN="${NPM_BIN:-/usr/bin/npm}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-/usr/bin/systemctl}"
SUDO_BIN="${SUDO_BIN-sudo}"
CURL_BIN="${CURL_BIN:-/usr/bin/curl}"
PGREP_BIN="${PGREP_BIN:-/usr/bin/pgrep}"
ACTIVE_JOB_WAIT_SECONDS="${ACTIVE_JOB_WAIT_SECONDS:-900}"
ACTIVE_JOB_POLL_SECONDS="${ACTIVE_JOB_POLL_SECONDS:-10}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_RETRY_SECONDS="${HEALTH_RETRY_SECONDS:-3}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"

if [[ ! "$TARGET_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "Deployment requires an exact 40-character Git SHA." >&2
  exit 64
fi
TARGET_SHA="${TARGET_SHA,,}"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "Application repository not found: $APP_DIR" >&2
  exit 66
fi

cd "$APP_DIR"

DEPLOY_STATE_DIR="$APP_DIR/.deploy"
LOCK_DIR="$DEPLOY_STATE_DIR/lock"
BACKUP_ROOT="$APP_DIR/backups/deploy"
mkdir -p "$DEPLOY_STATE_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another deployment is already running: $LOCK_DIR" >&2
  exit 75
fi

cleanup_lock() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup_lock EXIT

if ! git diff --quiet --ignore-submodules -- || ! git diff --cached --quiet --ignore-submodules --; then
  echo "Tracked files have local changes; refusing to overwrite the server checkout." >&2
  exit 65
fi

wait_for_active_jobs() {
  local started_at now elapsed
  local pattern='server/(dailyJob|strictMonthlyBacktestJob|roughMonteCarloJob)\.(ts|js)|job:(daily|strict-monthly-backtest|strict-full-backtest|rough-monte-carlo)'
  started_at="$(date +%s)"

  while "$PGREP_BIN" -f "$pattern" >/dev/null 2>&1; do
    now="$(date +%s)"
    elapsed=$((now - started_at))
    if (( elapsed >= ACTIVE_JOB_WAIT_SECONDS )); then
      echo "A daily job or backtest is still running after ${ACTIVE_JOB_WAIT_SECONDS}s; deployment stopped." >&2
      return 1
    fi
    echo "Waiting for an active daily job or backtest to finish..."
    sleep "$ACTIVE_JOB_POLL_SECONDS"
  done
}

if ! wait_for_active_jobs; then
  exit 75
fi

PREVIOUS_SHA="$(git rev-parse HEAD | tr '[:upper:]' '[:lower:]')"
DEPLOY_REF="refs/remotes/$DEPLOY_REMOTE/$DEPLOY_BRANCH"

echo "Fetching $DEPLOY_REMOTE/$DEPLOY_BRANCH..."
git fetch --prune "$DEPLOY_REMOTE" \
  "+refs/heads/$DEPLOY_BRANCH:$DEPLOY_REF"

if ! git cat-file -e "$TARGET_SHA^{commit}" 2>/dev/null; then
  echo "Target commit is not available after fetch: $TARGET_SHA" >&2
  exit 65
fi

if ! git merge-base --is-ancestor "$TARGET_SHA" "$DEPLOY_REF"; then
  echo "Target commit is not part of $DEPLOY_REMOTE/$DEPLOY_BRANCH: $TARGET_SHA" >&2
  exit 65
fi

backup_persistent_state() {
  local timestamp backup_dir
  timestamp="$(date -u +%Y%m%d-%H%M%S)"
  backup_dir="$BACKUP_ROOT/${timestamp}-${TARGET_SHA:0:12}"
  mkdir -p "$backup_dir"

  if [ -d "$APP_DIR/data" ]; then
    cp -a "$APP_DIR/data" "$backup_dir/data"
  fi
  if [ -f "$APP_DIR/.env" ]; then
    cp -a "$APP_DIR/.env" "$backup_dir/.env"
  fi

  mapfile -t old_backups < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%p\n' | sort -r)
  if (( ${#old_backups[@]} > BACKUP_KEEP )); then
    local old_backup
    for old_backup in "${old_backups[@]:BACKUP_KEEP}"; do
      rm -rf -- "$old_backup"
    done
  fi
}

run_systemctl() {
  if [ -n "$SUDO_BIN" ]; then
    "$SUDO_BIN" "$SYSTEMCTL_BIN" "$@"
  else
    "$SYSTEMCTL_BIN" "$@"
  fi
}

check_health() {
  local attempt
  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt += 1)); do
    if "$CURL_BIN" -fsS "$HEALTH_URL" 2>/dev/null | grep -Eq '"ready"[[:space:]]*:[[:space:]]*true'; then
      return 0
    fi
    sleep "$HEALTH_RETRY_SECONDS"
  done
  echo "Service health check failed after $HEALTH_RETRIES attempts: $HEALTH_URL" >&2
  return 1
}

install_and_start() {
  local sha="$1"
  git checkout --detach "$sha" || return $?
  "$NPM_BIN" ci || return $?
  "$NPM_BIN" run build || return $?
  run_systemctl restart "$SERVICE_NAME" || return $?
  check_health || return $?
}

write_metadata() {
  local status="$1"
  local git_sha="$2"
  local previous_sha="${3:-}"
  local deployed_at temp_file
  deployed_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  mkdir -p "$APP_DIR/data"
  temp_file="$APP_DIR/data/deployment.json.tmp.$$"

  if [ -n "$previous_sha" ]; then
    printf '{"status":"%s","gitSha":"%s","previousGitSha":"%s","deployedAt":"%s"}\n' \
      "$status" "$git_sha" "$previous_sha" "$deployed_at" > "$temp_file"
  else
    printf '{"status":"%s","gitSha":"%s","deployedAt":"%s"}\n' \
      "$status" "$git_sha" "$deployed_at" > "$temp_file"
  fi
  mv "$temp_file" "$APP_DIR/data/deployment.json"
}

backup_persistent_state

echo "Deploying $TARGET_SHA (previous $PREVIOUS_SHA)..."
if install_and_start "$TARGET_SHA"; then
  write_metadata "success" "$TARGET_SHA" "$PREVIOUS_SHA"
  echo "Deployment succeeded: $TARGET_SHA"
  exit 0
fi

deploy_exit=$?
echo "Deployment failed; restoring $PREVIOUS_SHA..." >&2

if install_and_start "$PREVIOUS_SHA"; then
  write_metadata "rolled_back" "$PREVIOUS_SHA"
  echo "Rollback succeeded: $PREVIOUS_SHA" >&2
else
  rollback_exit=$?
  current_sha="$(git rev-parse HEAD 2>/dev/null || printf '%s' "$PREVIOUS_SHA")"
  write_metadata "failed" "$current_sha"
  echo "Rollback also failed; manual recovery is required." >&2
  exit "$rollback_exit"
fi

if (( deploy_exit == 0 )); then
  deploy_exit=1
fi
exit "$deploy_exit"
