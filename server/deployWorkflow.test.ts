import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = path.resolve(process.cwd(), ".github/workflows/deploy-production.yml");

async function readWorkflow() {
  return readFile(workflowPath, "utf-8");
}

describe("production deployment workflow", () => {
  it("deploys verified main commits with serialized production concurrency", async () => {
    const workflow = await readWorkflow();

    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("group: mingyuan-production");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("queue: max");
    expect(workflow).toContain("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683");
    expect(workflow).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm test -- --run");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("bash -n deploy/scripts/deploy-on-server.sh");
    expect(workflow).toContain("bash deploy/scripts/deploy-on-server.test.sh");

    const verifyIndex = workflow.indexOf("npm test -- --run");
    const deployIndex = workflow.indexOf("scp deploy/scripts/deploy-on-server.sh");
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(deployIndex).toBeGreaterThan(verifyIndex);
  });

  it("pins the SSH host and deploys the exact workflow SHA", async () => {
    const workflow = await readWorkflow();

    expect(workflow).toContain("secrets.DEPLOY_KNOWN_HOSTS");
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).not.toContain("StrictHostKeyChecking=no");
    expect(workflow).toContain("secrets.DEPLOY_SSH_KEY");
    expect(workflow).toContain("secrets.DEPLOY_HOST");
    expect(workflow).toContain("secrets.DEPLOY_PORT");
    expect(workflow).toContain("secrets.DEPLOY_USER");
    expect(workflow).toContain("${{ github.sha }}");

    const configureStepIndex = workflow.indexOf("Configure pinned SSH connection");
    const privateKeySecretIndex = workflow.indexOf("DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}");
    expect(configureStepIndex).toBeGreaterThan(-1);
    expect(privateKeySecretIndex).toBeGreaterThan(configureStepIndex);
  });

  it("verifies deployment identity over SSH and public reachability separately", async () => {
    const workflow = await readWorkflow();

    expect(workflow).toContain("/api/live/health");
    expect(workflow).toContain("Verify deployed identity over SSH");
    expect(workflow).toContain("Verify public production reachability");
    expect(workflow).toContain("deployment.gitSha");
    expect(workflow).toContain("EXPECTED_SHA");
    expect(workflow).toContain("ssh mingyuan-production");
  });
});
