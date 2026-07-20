#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-on-server.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

expect_failure() {
  if "$@"; then
    fail "command unexpectedly succeeded: $*"
  fi
}

assert_equal() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  [ "$expected" = "$actual" ] || fail "$message (expected '$expected', got '$actual')"
}

[ -f "$DEPLOY_SCRIPT" ] || fail "missing deploy-on-server.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

REMOTE_DIR="$TMP_DIR/remote.git"
SOURCE_DIR="$TMP_DIR/source"
APP_DIR="$TMP_DIR/app"
FAKE_BIN="$TMP_DIR/bin"
COMMAND_LOG="$TMP_DIR/commands.log"

git init --bare "$REMOTE_DIR" >/dev/null
git init -b main "$SOURCE_DIR" >/dev/null
git -C "$SOURCE_DIR" config user.email "deploy-test@example.com"
git -C "$SOURCE_DIR" config user.name "Deploy Test"

cat > "$SOURCE_DIR/.gitignore" <<'EOF'
data/
output/
backups/
.env
.deploy/
EOF
echo "version-one" > "$SOURCE_DIR/version.txt"
echo '{"name":"deploy-fixture","scripts":{"build":"true"}}' > "$SOURCE_DIR/package.json"
git -C "$SOURCE_DIR" add .
git -C "$SOURCE_DIR" commit -m "version one" >/dev/null
git -C "$SOURCE_DIR" remote add origin "$REMOTE_DIR"
git -C "$SOURCE_DIR" push -u origin main >/dev/null
git --git-dir="$REMOTE_DIR" symbolic-ref HEAD refs/heads/main
SHA_ONE="$(git -C "$SOURCE_DIR" rev-parse HEAD)"

echo "version-two" > "$SOURCE_DIR/version.txt"
git -C "$SOURCE_DIR" commit -am "version two" >/dev/null
git -C "$SOURCE_DIR" push >/dev/null
SHA_TWO="$(git -C "$SOURCE_DIR" rev-parse HEAD)"

git clone "$REMOTE_DIR" "$APP_DIR" >/dev/null
git -C "$APP_DIR" checkout --detach "$SHA_ONE" >/dev/null
mkdir -p "$APP_DIR/data/backtest-cache" "$APP_DIR/output/logs" "$APP_DIR/output/backtests" "$FAKE_BIN"
echo '{"holdings":[{"code":"600000","quantity":100}]}' > "$APP_DIR/data/paper-trading.json"
echo "rebuildable-cache" > "$APP_DIR/data/backtest-cache/history.json"
echo "historical-log" > "$APP_DIR/output/logs/daily.log"
echo "large-backtest-result" > "$APP_DIR/output/backtests/strict.jsonl"
echo "WEWORK_WEBHOOK_URL=secret-value" > "$APP_DIR/.env"

PAPER_SUM="$(sha256sum "$APP_DIR/data/paper-trading.json" | awk '{print $1}')"
CACHE_SUM="$(sha256sum "$APP_DIR/data/backtest-cache/history.json" | awk '{print $1}')"
OUTPUT_SUM="$(sha256sum "$APP_DIR/output/logs/daily.log" | awk '{print $1}')"
BACKTEST_SUM="$(sha256sum "$APP_DIR/output/backtests/strict.jsonl" | awk '{print $1}')"
ENV_SUM="$(sha256sum "$APP_DIR/.env" | awk '{print $1}')"

cat > "$FAKE_BIN/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "npm $*" >> "$COMMAND_LOG"
if [ "$*" = "run build" ] && [ -f "$APP_DIR/FAIL_BUILD" ]; then
  echo '{"holdings":[]}' > "$APP_DIR/data/paper-trading.json"
  echo "corrupted-log" > "$APP_DIR/output/logs/daily.log"
  echo "temporary-output" > "$APP_DIR/output/logs/temporary.log"
  echo "WEWORK_WEBHOOK_URL=corrupted" > "$APP_DIR/.env"
  exit 42
fi
EOF

cat > "$FAKE_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "systemctl $*" >> "$COMMAND_LOG"
EOF

cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "curl $*" >> "$COMMAND_LOG"
printf '%s\n' '{"ready":true}'
EOF

cat > "$FAKE_BIN/pgrep" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

chmod +x "$FAKE_BIN"/*

run_deploy() {
  APP_DIR="$APP_DIR" \
  NPM_BIN="$FAKE_BIN/npm" \
  SYSTEMCTL_BIN="$FAKE_BIN/systemctl" \
  SUDO_BIN="" \
  CURL_BIN="$FAKE_BIN/curl" \
  PGREP_BIN="$FAKE_BIN/pgrep" \
  COMMAND_LOG="$COMMAND_LOG" \
  HEALTH_RETRIES=2 \
  HEALTH_RETRY_SECONDS=0 \
  ACTIVE_JOB_WAIT_SECONDS=0 \
  bash "$DEPLOY_SCRIPT" "$1"
}

expect_failure run_deploy "not-a-sha"

echo "dirty" >> "$APP_DIR/version.txt"
expect_failure run_deploy "$SHA_TWO"
git -C "$APP_DIR" checkout -- version.txt

mkdir -p "$APP_DIR/.deploy/operation.lock"
expect_failure run_deploy "$SHA_TWO"
rmdir "$APP_DIR/.deploy/operation.lock"

mkdir -p "$APP_DIR/.deploy/operation.lock"
printf '%s\n' '{"pid":999999,"name":"stale-job","startedAt":"2000-01-01T00:00:00.000Z","token":"stale"}' \
  > "$APP_DIR/.deploy/operation.lock/owner.json"

run_deploy "$SHA_TWO"
assert_equal "$SHA_TWO" "$(git -C "$APP_DIR" rev-parse HEAD)" "exact target SHA was not deployed"
assert_equal "version-two" "$(cat "$APP_DIR/version.txt")" "target files were not checked out"
assert_equal "$PAPER_SUM" "$(sha256sum "$APP_DIR/data/paper-trading.json" | awk '{print $1}')" "paper account changed"
assert_equal "$CACHE_SUM" "$(sha256sum "$APP_DIR/data/backtest-cache/history.json" | awk '{print $1}')" "backtest cache changed"
assert_equal "$OUTPUT_SUM" "$(sha256sum "$APP_DIR/output/logs/daily.log" | awk '{print $1}')" "output history changed"
assert_equal "$BACKTEST_SUM" "$(sha256sum "$APP_DIR/output/backtests/strict.jsonl" | awk '{print $1}')" "backtest result changed"
assert_equal "$ENV_SUM" "$(sha256sum "$APP_DIR/.env" | awk '{print $1}')" ".env changed"
grep -q "\"gitSha\":\"$SHA_TWO\"" "$APP_DIR/data/deployment.json" || fail "success metadata missing target SHA"
grep -q '"status":"success"' "$APP_DIR/data/deployment.json" || fail "success metadata missing status"
find "$APP_DIR/backups/deploy" -mindepth 1 -maxdepth 1 -type d | grep -q . || fail "deployment backup was not created"
PERSISTENT_ARCHIVE="$(find "$APP_DIR/backups/deploy" -name persistent-state.tar.gz -type f | head -1)"
[ -n "$PERSISTENT_ARCHIVE" ] || fail "persistent-state archive was not created"
if tar -tzf "$PERSISTENT_ARCHIVE" | grep -Eq '^data/backtest-cache(/|$)|^output/backtests(/|$)'; then
  fail "rebuildable backtest artifacts were included in the deployment archive"
fi

touch "$SOURCE_DIR/FAIL_BUILD"
git -C "$SOURCE_DIR" add FAIL_BUILD
git -C "$SOURCE_DIR" commit -m "broken version" >/dev/null
git -C "$SOURCE_DIR" push >/dev/null
SHA_BROKEN="$(git -C "$SOURCE_DIR" rev-parse HEAD)"

expect_failure run_deploy "$SHA_BROKEN"
assert_equal "$SHA_TWO" "$(git -C "$APP_DIR" rev-parse HEAD)" "failed build did not roll back"
grep -q '"status":"rolled_back"' "$APP_DIR/data/deployment.json" || fail "rollback metadata missing status"
grep -q "\"gitSha\":\"$SHA_TWO\"" "$APP_DIR/data/deployment.json" || fail "rollback metadata missing restored SHA"
assert_equal "$PAPER_SUM" "$(sha256sum "$APP_DIR/data/paper-trading.json" | awk '{print $1}')" "paper account changed after rollback"
assert_equal "$CACHE_SUM" "$(sha256sum "$APP_DIR/data/backtest-cache/history.json" | awk '{print $1}')" "backtest cache changed after rollback"
assert_equal "$OUTPUT_SUM" "$(sha256sum "$APP_DIR/output/logs/daily.log" | awk '{print $1}')" "output history changed after rollback"
assert_equal "$BACKTEST_SUM" "$(sha256sum "$APP_DIR/output/backtests/strict.jsonl" | awk '{print $1}')" "backtest result changed after rollback"
assert_equal "$ENV_SUM" "$(sha256sum "$APP_DIR/.env" | awk '{print $1}')" ".env changed after rollback"
[ ! -e "$APP_DIR/output/logs/temporary.log" ] || fail "temporary output survived rollback"

echo "deploy-on-server integration tests passed"
