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

## Hands-Off Production Releases

After the one-time setup below, every verified push to `main` deploys the exact
Git commit to the Tencent Cloud server. The workflow runs the full test suite,
production build, deployment-script tests, a consistent runtime snapshot,
service restart, and both authenticated server and public reachability checks.
A failed build or health check restores both the previous working commit and the
pre-deploy runtime snapshot automatically.

### 1. Create A Dedicated Deployment Key

Create this key on a trusted computer. Do not reuse a personal SSH key. Leave the
passphrase empty because GitHub Actions runs without an interactive prompt.

```bash
ssh-keygen -t ed25519 -C "github-actions-mingyuan-production" -f ~/.ssh/mingyuan_github_actions
```

This creates:

- `~/.ssh/mingyuan_github_actions`: private key, used only for the GitHub secret.
- `~/.ssh/mingyuan_github_actions.pub`: public key, authorized on the server.

Do not paste the private key into chat, a commit, a log, or the server repository.

### 2. Authorize Only The Public Key On Tencent Cloud

Log in once as the deployment user (`ubuntu` in the current server), then append
the `.pub` line. The optional `restrict` prefix disables SSH forwarding and PTY
features that this deployment does not need.

```bash
install -d -m 700 ~/.ssh
printf '%s\n' 'restrict ssh-ed25519 REPLACE_WITH_PUBLIC_KEY github-actions-mingyuan-production' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
sudo -n /usr/bin/systemctl status mingyuan-trading >/dev/null
```

The last command must complete without asking for a password. The deployment
script only needs permission to stop, start, and restart `mingyuan-trading`; do
not expose the application's `.env` or Enterprise WeChat webhook.

### 3. Record The Real Server Host Key

Read the host key on the server itself so GitHub Actions can reject an unexpected
machine. For the current public IP and default SSH port, run:

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
printf '159.75.41.16 %s\n' "$(sudo awk '{print $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub)"
```

Save the complete second output line as `DEPLOY_KNOWN_HOSTS`. If SSH later moves
away from port `22`, use `[159.75.41.16]:NEW_PORT` at the start of that line.

### 4. Add Five GitHub Actions Secrets

Open `winter7775/licai` on GitHub, then go to **Settings > Secrets and variables >
Actions > New repository secret**. Add exactly these names:

| Secret | Current value |
| --- | --- |
| `DEPLOY_HOST` | `159.75.41.16` |
| `DEPLOY_PORT` | `22` unless the Tencent Cloud SSH port was changed |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_SSH_KEY` | Complete contents of the dedicated private key |
| `DEPLOY_KNOWN_HOSTS` | Host-key line produced on the server |

When the GitHub CLI is already authenticated on the trusted computer, the private
key can be sent without printing it to the terminal:

```bash
gh secret set DEPLOY_SSH_KEY --repo winter7775/licai < ~/.ssh/mingyuan_github_actions
```

Use the GitHub settings form for the other four values, or pipe them to `gh secret
set` in the same way. Never place secret values directly in a shell-history command.

### 5. Normal Release And Recovery

Normal releases require no Tencent Cloud login:

1. Merge or push a verified commit to `main`.
2. Open the repository's **Actions > Deploy production** page to see verification,
   deployment, rollback, and public-health status.
3. Confirm the workflow's authenticated SSH check reports the exact commit and
   the public `http://159.75.41.16:4173/api/live/health` endpoint is reachable.

The workflow can also be rerun with **Run workflow** (`workflow_dispatch`) without
changing code. A red run with `rolled_back` means the old version is serving again;
inspect the Actions log before retrying. Runtime `data/`, `.env`, and `output/`
are snapshotted while the service is stopped and restored after every build, so
package scripts cannot silently mutate them. Rebuildable `data/backtest-cache/`
and large `output/backtests/` artifacts stay in place but are excluded from the
compressed rollback archive, keeping the service interruption short. The ten
newest compressed snapshots are kept under
`/opt/mingyuan/trading-system/backups/deploy/`.

Deployments, daily jobs, and backtests share `.deploy/operation.lock`. A release
waits while a calculation is active; a newly started calculation refuses to run
while deployment owns the lock. Dead-process locks are recovered automatically.

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

## Emergency Manual Update

The automatic workflow already backs up runtime data. Use this manual path only
when GitHub Actions is unavailable and the incident has been reviewed.

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
