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
INSTALL_BIN="${INSTALL_BIN:-/usr/bin/install}"
CHOWN_BIN="${CHOWN_BIN:-/usr/bin/chown}"
CURL_BIN="${CURL_BIN:-/usr/bin/curl}"
PGREP_BIN="${PGREP_BIN:-/usr/bin/pgrep}"
ACTIVE_JOB_WAIT_SECONDS="${ACTIVE_JOB_WAIT_SECONDS:-900}"
ACTIVE_JOB_POLL_SECONDS="${ACTIVE_JOB_POLL_SECONDS:-10}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_RETRY_SECONDS="${HEALTH_RETRY_SECONDS:-3}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
LOCK_STALE_SECONDS="${LOCK_STALE_SECONDS:-60}"
SERVICE_UNIT_SOURCE="${SERVICE_UNIT_SOURCE:-$APP_DIR/deploy/systemd/mingyuan-trading.service.example}"
SERVICE_UNIT_TARGET="${SERVICE_UNIT_TARGET:-/etc/systemd/system/mingyuan-trading.service}"

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
LOCK_DIR="$DEPLOY_STATE_DIR/operation.lock"
BACKUP_ROOT="$APP_DIR/backups/deploy"
LOCK_TOKEN="deploy-$$-$(date +%s)-${RANDOM}"
LOCK_ACQUIRED=0
BACKUP_DIR=""
PERSISTENT_BACKUP=""
mkdir -p "$DEPLOY_STATE_DIR"

lock_owner_pid() {
  sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$LOCK_DIR/owner.json" 2>/dev/null | head -1
}

lock_is_stale() {
  local owner_pid modified_at now
  owner_pid="$(lock_owner_pid)"
  if [ -n "$owner_pid" ]; then
    if kill -0 "$owner_pid" 2>/dev/null; then
      return 1
    fi
    return 0
  fi

  modified_at="$(stat -c %Y "$LOCK_DIR" 2>/dev/null || printf '0')"
  now="$(date +%s)"
  (( now - modified_at >= LOCK_STALE_SECONDS ))
}

acquire_operation_lock() {
  local started_at now elapsed stale_dir
  started_at="$(date +%s)"

  while true; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf '{"pid":%s,"name":"deployment","startedAt":"%s","token":"%s"}\n' \
        "$$" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$LOCK_TOKEN" > "$LOCK_DIR/owner.json"
      LOCK_ACQUIRED=1
      return 0
    fi

    if lock_is_stale; then
      stale_dir="$DEPLOY_STATE_DIR/operation.lock.stale-$$-${RANDOM}"
      if mv "$LOCK_DIR" "$stale_dir" 2>/dev/null; then
        rm -rf -- "$stale_dir"
      fi
      continue
    fi

    now="$(date +%s)"
    elapsed=$((now - started_at))
    if (( elapsed >= ACTIVE_JOB_WAIT_SECONDS )); then
      echo "Another deployment, daily job, or backtest holds the operation lock: $LOCK_DIR" >&2
      return 1
    fi
    echo "Waiting for the current server operation to finish..."
    sleep "$ACTIVE_JOB_POLL_SECONDS"
  done
}

cleanup_lock() {
  if (( LOCK_ACQUIRED == 1 )) && grep -Fq "\"token\":\"$LOCK_TOKEN\"" "$LOCK_DIR/owner.json" 2>/dev/null; then
    rm -rf -- "$LOCK_DIR"
  fi
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

if ! acquire_operation_lock; then
  exit 75
fi

if ! wait_for_active_jobs; then
  exit 75
fi

backup_persistent_state() {
  local timestamp
  local -a entries=()
  timestamp="$(date -u +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_ROOT"
  BACKUP_DIR="$(mktemp -d "$BACKUP_ROOT/${timestamp}-${TARGET_SHA:0:12}-XXXXXX")"
  PERSISTENT_BACKUP="$BACKUP_DIR/persistent-state.tar.gz"

  if [ -d "$APP_DIR/data" ]; then
    entries+=(data)
  fi
  if [ -f "$APP_DIR/.env" ]; then
    entries+=(.env)
  fi
  if [ -d "$APP_DIR/output" ]; then
    entries+=(output)
  fi

  if (( ${#entries[@]} > 0 )); then
    tar -czf "$PERSISTENT_BACKUP" \
      --exclude='data/backtest-cache' \
      --exclude='output/backtests' \
      -C "$APP_DIR" "${entries[@]}"
  else
    tar -czf "$PERSISTENT_BACKUP" --files-from /dev/null
  fi

  mapfile -t old_backups < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%p\n' | sort -r)
  if (( ${#old_backups[@]} > BACKUP_KEEP )); then
    local old_backup
    for old_backup in "${old_backups[@]:BACKUP_KEEP}"; do
      rm -rf -- "$old_backup"
    done
  fi
}

restore_persistent_state() {
  local preserved_root
  if [ ! -f "$PERSISTENT_BACKUP" ]; then
    echo "Persistent-state backup is unavailable; refusing an unsafe restore." >&2
    return 1
  fi

  preserved_root="$(mktemp -d "$DEPLOY_STATE_DIR/preserved-state-XXXXXX")"
  if [ -d "$APP_DIR/data/backtest-cache" ]; then
    mkdir -p "$preserved_root/data"
    mv "$APP_DIR/data/backtest-cache" "$preserved_root/data/backtest-cache"
  fi
  if [ -d "$APP_DIR/output/backtests" ]; then
    mkdir -p "$preserved_root/output"
    mv "$APP_DIR/output/backtests" "$preserved_root/output/backtests"
  fi

  rm -rf -- "$APP_DIR/data" "$APP_DIR/output"
  rm -f -- "$APP_DIR/.env"
  tar -xzf "$PERSISTENT_BACKUP" -C "$APP_DIR"

  if [ -d "$preserved_root/data/backtest-cache" ]; then
    mkdir -p "$APP_DIR/data"
    mv "$preserved_root/data/backtest-cache" "$APP_DIR/data/backtest-cache"
  fi
  if [ -d "$preserved_root/output/backtests" ]; then
    mkdir -p "$APP_DIR/output"
    mv "$preserved_root/output/backtests" "$APP_DIR/output/backtests"
  fi
  rm -rf -- "$preserved_root"
}

run_systemctl() {
  if [ -n "$SUDO_BIN" ]; then
    "$SUDO_BIN" "$SYSTEMCTL_BIN" "$@"
  else
    "$SYSTEMCTL_BIN" "$@"
  fi
}

run_privileged() {
  if [ -n "$SUDO_BIN" ]; then
    "$SUDO_BIN" "$@"
  else
    "$@"
  fi
}

install_runtime_permissions_and_service() {
  local app_owner
  app_owner="$(id -un):$(id -gn)"
  mkdir -p "$APP_DIR/data" "$APP_DIR/output"
  run_privileged "$CHOWN_BIN" -R "$app_owner" "$APP_DIR/data" "$APP_DIR/output" || return $?
  run_privileged "$INSTALL_BIN" -m 0644 "$SERVICE_UNIT_SOURCE" "$SERVICE_UNIT_TARGET" || return $?
  run_systemctl daemon-reload || return $?
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

install_code() {
  local sha="$1"
  git checkout --detach "$sha" || return $?
  "$NPM_BIN" ci || return $?
  "$NPM_BIN" run build || return $?
}

start_and_check() {
  install_runtime_permissions_and_service || return $?
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

if ! run_systemctl stop "$SERVICE_NAME"; then
  echo "Could not stop $SERVICE_NAME before taking a consistent snapshot." >&2
  exit 1
fi

if ! backup_persistent_state; then
  echo "Could not create the persistent-state snapshot; deployment aborted." >&2
  run_systemctl start "$SERVICE_NAME" || true
  exit 1
fi

echo "Deploying $TARGET_SHA (previous $PREVIOUS_SHA)..."
if install_code "$TARGET_SHA" && restore_persistent_state && start_and_check; then
  if write_metadata "success" "$TARGET_SHA" "$PREVIOUS_SHA"; then
    echo "Deployment succeeded: $TARGET_SHA"
    exit 0
  fi
  echo "Deployment metadata could not be persisted." >&2
fi

deploy_exit=$?
echo "Deployment failed; restoring $PREVIOUS_SHA..." >&2
run_systemctl stop "$SERVICE_NAME" || true

rollback_ok=1
if ! install_code "$PREVIOUS_SHA"; then
  rollback_ok=0
fi
if ! restore_persistent_state; then
  rollback_ok=0
fi

if (( rollback_ok == 1 )) && start_and_check; then
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
