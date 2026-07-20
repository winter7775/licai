# GitHub Automatic Deployment Design

## Goal

Remove the recurring requirement for the user to log in to the Tencent Cloud server and manually run `git pull`, dependency installation, build, and service restart commands.

After the one-time credential setup, the normal release path is:

1. Codex changes and verifies the trading-system code locally.
2. Codex pushes an approved commit to the GitHub `main` branch.
3. GitHub Actions verifies the same commit and deploys that exact commit to Tencent Cloud.
4. The server backs up persistent data, installs dependencies, builds, restarts the service, and checks the production API.
5. A failed deployment automatically returns the application code to the previous commit.

The user only needs to help once with SSH authorization and GitHub repository secrets. Routine releases must not require a server login.

## Chosen Approach

Use GitHub Actions as the release controller and SSH as the server transport.

This is preferred over server-side polling because the Tencent Cloud server has previously experienced intermittent GitHub connectivity. It is also preferred over a public webhook because a webhook would add another internet-facing endpoint and signature-validation surface.

The workflow uses only official GitHub actions for checkout and Node setup. Remote commands use the OpenSSH client already present on the GitHub-hosted Ubuntu runner.

## Trigger And Release Rules

The production workflow runs when:

- a commit is pushed to `main`; or
- Codex or the repository owner starts it manually through `workflow_dispatch`.

Only one production deployment may run at a time. A newer run cancels an older run that has not yet reached the server.

Before connecting to Tencent Cloud, GitHub Actions must run:

- `npm ci`
- the complete Vitest suite
- `npm run build`
- shell syntax validation for deployment scripts

No server update occurs when any verification step fails.

## One-Time Credentials

The repository will require these GitHub Actions secrets:

- `DEPLOY_HOST`: Tencent Cloud public IP or domain.
- `DEPLOY_PORT`: SSH port, normally `22`.
- `DEPLOY_USER`: the Linux deployment user, currently expected to be `ubuntu`.
- `DEPLOY_SSH_KEY`: a dedicated private key whose public half is authorized on the server.
- `DEPLOY_KNOWN_HOSTS`: the pinned SSH host-key line for the Tencent Cloud server.

Host-key checking remains enabled. The workflow must not use `StrictHostKeyChecking=no`.

The dedicated key is used only for deployment. It is never committed to Git, printed in logs, or stored in the application `.env` file.

## Server Deployment Script

Create `deploy/scripts/deploy-on-server.sh`. It receives the exact Git commit SHA from GitHub Actions and owns all server-side update behavior.

The script must:

1. Acquire the shared server-operation lock under the application directory.
2. Verify the target is a 40-character hexadecimal Git SHA.
3. Verify the existing checkout has no tracked local modifications.
4. Remember the current commit for rollback.
5. Stop the web service and create a timestamped compressed snapshot of `data/`, `.env`, and `output/` when present.
6. Retain a bounded number of deployment backups.
7. Fetch the requested commit and verify it belongs to `origin/main`.
8. Switch the checkout to that exact commit without deleting ignored runtime files.
9. Run `npm ci` and `npm run build`.
10. Restore the pre-deploy persistent snapshot, then restart `mingyuan-trading.service`.
11. Wait for both `systemctl is-active` and `/api/live/health` to become healthy.
12. Write deployment metadata and a concise deployment log.

The script does not run the daily trading job and does not modify strategy data.

## Persistent Data Boundary

These paths are runtime state and must survive every deployment:

- `data/`
- `.env`
- `output/`
- `backups/`

The deployment may read or snapshot these paths but must never replace them from GitHub artifacts. The service is stopped while the snapshot is created, and the snapshot is restored after build scripts finish so dependency lifecycle scripts cannot mutate runtime trading state.

The repository already ignores the main mutable paper-trading files. The deployment script adds a safety check that refuses to proceed when tracked files have local server edits, because silently discarding an uncommitted server fix would make GitHub and production diverge.

## Rollback

If dependency installation, build, restart, or health verification fails after the code switch:

1. Record the failed target SHA and failure stage.
2. Switch the checkout back to the remembered previous SHA.
3. Reinstall dependencies and rebuild the previous version.
4. Restore `data/`, `.env`, and `output/` from the pre-deploy snapshot.
5. Restart the service and run the health check again.
6. Exit with failure so GitHub Actions visibly marks the deployment red.

If rollback itself fails, the workflow must report the failure clearly and retain all backups and logs for diagnosis.

## Backtest And Daily-Job Coordination

Deployments, daily jobs, and backtests acquire the same atomic operation lock. The deployment script also checks for an older running process that predates the shared-lock implementation before changing dependencies.

When one is active, the deployment waits for a bounded period. If it remains active, the release fails without changing the checkout. This protects long-running calculations and prevents `npm ci` from changing modules underneath a live job. Codex can rerun the GitHub workflow later; the user does not need to log into the server.

The main web service may be restarted during deployment. This creates a short maintenance window but does not remove persistent data.

## Production Verification

The deployment is considered successful only when all of the following are true:

- the server checkout SHA equals the GitHub workflow SHA;
- `mingyuan-trading.service` is active;
- `http://127.0.0.1:4173/api/live/health` returns HTTP 200;
- the exact deployed SHA is confirmed through the host-key-pinned SSH connection;
- the public endpoint `http://159.75.41.16:4173/api/live/health` returns HTTP 200 from the GitHub runner;
- deployment metadata records the SHA, timestamp, previous SHA, and successful status.

The SSH check proves deployment identity. The plain-HTTP public check only proves that the security group and exposed application path still work; it is not treated as an authenticated identity check.

## Documentation And Operator Flow

Update `deploy/README.md` with a one-time setup section covering:

1. Creating the dedicated deployment key.
2. Adding its public key to the server.
3. Capturing the pinned server host key.
4. Adding the five repository secrets.
5. Running the first manual GitHub Actions deployment.
6. Reading deployment logs and rerunning a failed workflow.

After that setup, routine operation is simply: merge or push a verified change to `main` and observe the workflow result.

## Testing

Add automated coverage for the deployment contract:

- a valid SHA is accepted and malformed input is rejected;
- a dirty tracked checkout is rejected before any switch;
- persistent runtime files remain untouched;
- a successful mocked deployment reaches the target SHA;
- a failed health check triggers rollback to the previous SHA;
- concurrent deployment attempts cannot both proceed;
- workflow YAML contains required verification and host-key checking steps;
- shell scripts pass syntax validation.

The local test harness uses temporary Git repositories and mocked `npm`, `systemctl`, and `curl` commands. It must not need root privileges or affect the real server.

## Acceptance Criteria

- A push to `main` automatically starts the production workflow.
- Failed tests or builds never change Tencent Cloud.
- A successful workflow deploys the exact GitHub commit.
- `data/`, `.env`, output logs, and backtest results survive deployment.
- Production health is checked locally and publicly.
- A post-switch failure rolls code back automatically.
- Routine deployment requires no user server login.
- The remaining one-time action is limited to SSH authorization and GitHub secret setup.

## Out Of Scope

- Real-money broker deployment.
- Blue-green or multi-server high availability.
- Automatic database schema migrations.
- Replacing Tencent Cloud or the existing systemd service.
- Automatically deploying branches other than `main`.
