import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDeploymentStatus } from "./deploymentStatus";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

describe("deployment status", () => {
  it("returns null when metadata is missing", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mingyuan-deployment-"));

    await expect(readDeploymentStatus(path.join(tempDir, "missing.json"))).resolves.toBeNull();
  });

  it("reads valid deployment metadata", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mingyuan-deployment-"));
    const filePath = path.join(tempDir, "deployment.json");
    await writeFile(
      filePath,
      JSON.stringify({
        status: "success",
        gitSha: "1111111111111111111111111111111111111111",
        previousGitSha: "0000000000000000000000000000000000000000",
        deployedAt: "2026-07-20T05:00:00.000Z"
      }),
      "utf-8"
    );

    await expect(readDeploymentStatus(filePath)).resolves.toEqual({
      status: "success",
      gitSha: "1111111111111111111111111111111111111111",
      previousGitSha: "0000000000000000000000000000000000000000",
      deployedAt: "2026-07-20T05:00:00.000Z"
    });
  });

  it("hides malformed or incomplete metadata", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mingyuan-deployment-"));
    const malformedPath = path.join(tempDir, "malformed.json");
    const incompletePath = path.join(tempDir, "incomplete.json");
    await writeFile(malformedPath, "{not-json", "utf-8");
    await writeFile(incompletePath, JSON.stringify({ status: "success", gitSha: "short" }), "utf-8");

    await expect(readDeploymentStatus(malformedPath)).resolves.toBeNull();
    await expect(readDeploymentStatus(incompletePath)).resolves.toBeNull();
  });
});
