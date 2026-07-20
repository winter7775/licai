import { readFile } from "node:fs/promises";
import path from "node:path";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

export type DeploymentState = "success" | "rolled_back" | "failed";

export interface DeploymentStatus {
  status: DeploymentState;
  gitSha: string;
  previousGitSha?: string;
  deployedAt: string;
}

function isDeploymentState(value: unknown): value is DeploymentState {
  return value === "success" || value === "rolled_back" || value === "failed";
}

function normalizeDeploymentStatus(value: unknown): DeploymentStatus | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isDeploymentState(candidate.status)) return null;
  if (typeof candidate.gitSha !== "string" || !FULL_GIT_SHA.test(candidate.gitSha)) return null;
  if (typeof candidate.deployedAt !== "string" || !Number.isFinite(Date.parse(candidate.deployedAt))) return null;
  if (
    candidate.previousGitSha !== undefined &&
    (typeof candidate.previousGitSha !== "string" || !FULL_GIT_SHA.test(candidate.previousGitSha))
  ) {
    return null;
  }

  return {
    status: candidate.status,
    gitSha: candidate.gitSha.toLowerCase(),
    ...(candidate.previousGitSha ? { previousGitSha: candidate.previousGitSha.toLowerCase() } : {}),
    deployedAt: candidate.deployedAt
  };
}

export async function readDeploymentStatus(
  filePath = path.resolve(process.cwd(), "data/deployment.json")
): Promise<DeploymentStatus | null> {
  try {
    return normalizeDeploymentStatus(JSON.parse(await readFile(filePath, "utf-8")));
  } catch {
    return null;
  }
}
