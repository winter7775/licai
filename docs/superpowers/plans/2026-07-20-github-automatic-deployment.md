# GitHub Automatic Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy every verified `main` commit to the Tencent Cloud trading-system service without requiring the user to log in and run update commands.

**Architecture:** GitHub Actions verifies the commit, uploads a repository-owned deployment script over SSH, and asks the server to deploy the exact SHA. The server script locks deployments, preserves runtime data, backs up persistent files, checks for active long-running jobs, builds and restarts the service, verifies health, and rolls code back on failure.

**Tech Stack:** GitHub Actions, Bash, OpenSSH, Git, Node.js 20, npm, systemd, TypeScript, Vitest.

---

## File Structure

- `server/deploymentStatus.ts`: Reads and validates deployment metadata written by the server script.
- `server/deploymentStatus.test.ts`: Covers missing, valid, and malformed deployment metadata.
- `server/apiHandlers.ts`: Adds deployment identity to the existing health response.
- `server/apiHandlers.test.ts`: Verifies health remains ready and reports deployment metadata when available.
- `deploy/scripts/deploy-on-server.sh`: Owns locking, backup, exact-SHA checkout, build, restart, health verification, metadata, and rollback.
- `deploy/scripts/deploy-on-server.test.sh`: Integration-style shell test using temporary Git repositories and mocked service commands.
- `.github/workflows/deploy-production.yml`: Verifies and deploys `main` to Tencent Cloud.
- `server/deployWorkflow.test.ts`: Guards the workflow's security and release contract.
- `deploy/README.md`: Documents the one-time key/secret setup and normal hands-off release flow.

### Task 1: Deployment Metadata In Health API

**Files:**
- Create: `server/deploymentStatus.ts`
- Create: `server/deploymentStatus.test.ts`
- Modify: `server/apiHandlers.ts`
- Modify: `server/apiHandlers.test.ts`

- [ ] **Step 1: Write failing metadata tests**

Test that a missing metadata file returns `null`, a valid file returns its SHA/status/timestamps, and malformed JSON is treated as unavailable rather than making the health route fail.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npm.cmd test -- --run server/deploymentStatus.test.ts server/apiHandlers.test.ts`

Expected: fail because `deploymentStatus.ts` and the new health fields do not exist.

- [ ] **Step 3: Implement the metadata reader**

Read `data/deployment.json` by default, accept an optional path for tests, validate the 40-character SHA fields, and return a small typed object. Do not throw for missing or invalid data.

- [ ] **Step 4: Expose metadata from `/api/live/health`**

Add a `deployment` field while preserving the existing `provider`, `ready`, and `checkedAt` contract.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm.cmd test -- --run server/deploymentStatus.test.ts server/apiHandlers.test.ts`

- [ ] **Step 6: Commit**

Commit: `feat: expose deployment status in health api`

### Task 2: Safe Server-Side Deployment And Rollback

**Files:**
- Create: `deploy/scripts/deploy-on-server.sh`
- Create: `deploy/scripts/deploy-on-server.test.sh`

- [ ] **Step 1: Write the failing shell integration test**

The test creates a temporary bare remote and checkout, commits two versions, adds ignored `data/`, `.env`, and `output/` fixtures, and installs fake `npm`, `systemctl`, and `curl` executables. Cover:

- malformed SHA rejection;
- dirty tracked checkout rejection;
- successful exact-SHA deployment;
- persistent fixture checksums remain unchanged;
- pre-existing lock rejection;
- build failure rolls the checkout back to the previous SHA.

- [ ] **Step 2: Run the shell test and confirm RED**

Run from PowerShell:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' deploy/scripts/deploy-on-server.test.sh
```

Expected: fail because `deploy-on-server.sh` does not exist.

- [ ] **Step 3: Implement input, lock, and safety checks**

Use a 40-character SHA regex, an atomic directory lock under `$APP_DIR/.deploy`, a tracked-diff check, and an active-job wait with a bounded timeout.

- [ ] **Step 4: Implement backup and exact commit switch**

Back up `data/` and `.env` into `backups/deploy/`, keep a bounded history, fetch the target, verify it belongs to `origin/main`, and switch with `git checkout --detach` without removing ignored runtime files.

- [ ] **Step 5: Implement build, restart, health, metadata, and rollback**

Run `npm ci`, `npm run build`, restart `mingyuan-trading.service`, and retry the local health endpoint. Write `data/deployment.json`. On any post-switch failure, return to the previous SHA, rebuild, restart, and exit nonzero.

- [ ] **Step 6: Run shell tests and syntax validation**

Run:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' -n deploy/scripts/deploy-on-server.sh
& 'C:\Program Files\Git\bin\bash.exe' deploy/scripts/deploy-on-server.test.sh
```

Expected: all assertions pass.

- [ ] **Step 7: Commit**

Commit: `feat: add safe server deployment script`

### Task 3: GitHub Production Workflow

**Files:**
- Create: `.github/workflows/deploy-production.yml`
- Create: `server/deployWorkflow.test.ts`

- [ ] **Step 1: Write failing workflow contract tests**

Read the workflow as text and assert that it:

- triggers on `main` and `workflow_dispatch`;
- uses deployment concurrency;
- runs `npm ci`, the test suite, build, and shell validation before SSH;
- installs `DEPLOY_KNOWN_HOSTS` and never disables strict host checking;
- passes `${{ github.sha }}` to the uploaded deployment script;
- performs a public health check after remote deployment.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm.cmd test -- --run server/deployWorkflow.test.ts`

Expected: fail because the workflow does not exist.

- [ ] **Step 3: Implement the workflow**

Use `actions/checkout` and `actions/setup-node`, configure the SSH key with restrictive permissions, install the pinned known-hosts secret, upload the script to `/tmp`, execute it with the exact SHA, remove the temporary script, and check the public health endpoint.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npm.cmd test -- --run server/deployWorkflow.test.ts`

- [ ] **Step 5: Commit**

Commit: `ci: deploy verified main commits to production`

### Task 4: One-Time Setup And Recovery Guide

**Files:**
- Modify: `deploy/README.md`

- [ ] **Step 1: Document the one-time SSH key setup**

Include commands to generate a dedicated Ed25519 key, append only the public key to the server user's `authorized_keys`, and capture the server host key for `DEPLOY_KNOWN_HOSTS`.

- [ ] **Step 2: Document the five GitHub secrets**

Explain exact names, values, and how to avoid exposing the private key or `.env` webhook.

- [ ] **Step 3: Document normal releases and failures**

Explain that normal updates happen on push to `main`, where to see Actions status, what an automatic rollback means, and how Codex can manually rerun `workflow_dispatch` without the user logging into Tencent Cloud.

- [ ] **Step 4: Validate documentation commands and paths**

Check all examples use `/opt/mingyuan/trading-system`, service `mingyuan-trading`, port `4173`, and repository `winter7775/licai`.

- [ ] **Step 5: Commit**

Commit: `docs: add hands-off production deployment setup`

### Task 5: Full Local Verification And GitHub Sync

**Files:**
- No new files.

- [ ] **Step 1: Run all tests**

Run: `npm.cmd test -- --run`

Expected: all tests pass.

- [ ] **Step 2: Run the production build**

Run: `npm.cmd run build`

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Run shell deployment tests again**

Run:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' -n deploy/scripts/deploy-on-server.sh
& 'C:\Program Files\Git\bin\bash.exe' deploy/scripts/deploy-on-server.test.sh
```

- [ ] **Step 4: Inspect repository state and push**

Confirm only intended commits exist, then push `main` to `winter7775/licai`. Retry over HTTP/1.1 if the local GitHub TLS path is unstable.

- [ ] **Step 5: Stop before production mutation when secrets are absent**

If the five GitHub secrets are not yet configured, report the exact one-time inputs needed. Do not weaken SSH verification or use a password as a workaround.

### Task 6: One-Time Production Authorization And End-To-End Proof

**Files:**
- No repository changes unless verification finds a defect.

- [ ] **Step 1: Obtain the user's one-time authorization inputs**

Collect or help configure the dedicated server SSH key, deployment user, SSH port, and pinned host-key line.

- [ ] **Step 2: Configure GitHub Actions secrets**

Use the repository settings or GitHub CLI with the user's authenticated session. Never echo secret values back into chat or logs.

- [ ] **Step 3: Trigger the first production workflow**

Start `workflow_dispatch` or push a harmless verified commit.

- [ ] **Step 4: Verify GitHub and Tencent Cloud evidence**

Require a green workflow, matching production SHA in `/api/live/health`, active public URL, and unchanged paper-trading holdings/trade history.

- [ ] **Step 5: Mark the migration complete**

Only after the end-to-end proof, confirm that future code releases no longer require the user to log into the server.
