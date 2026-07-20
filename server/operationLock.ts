import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

interface LockOwner {
  pid: number;
  name: string;
  startedAt: string;
  token: string;
}

export interface OperationLockOptions {
  lockPath?: string;
  maxWaitMs?: number;
  pollMs?: number;
  staleAfterMs?: number;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
}

export interface OperationLock {
  owner: LockOwner;
  release: () => Promise<void>;
}

const DEFAULT_STALE_AFTER_MS = 60_000;

function defaultLockPath(): string {
  return path.join(process.cwd(), ".deploy", "operation.lock");
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    const owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8")) as Partial<LockOwner>;
    if (
      typeof owner.pid === "number" &&
      typeof owner.name === "string" &&
      typeof owner.startedAt === "string" &&
      typeof owner.token === "string"
    ) {
      return owner as LockOwner;
    }
  } catch {
    // A lock directory can briefly exist before its owner file is persisted.
  }
  return null;
}

async function recoverIfStale(
  lockPath: string,
  staleAfterMs: number,
  isProcessAlive: (pid: number) => boolean
): Promise<boolean> {
  const owner = await readOwner(lockPath);
  if (owner && isProcessAlive(owner.pid)) return false;

  if (!owner) {
    try {
      const lockStat = await stat(lockPath);
      if (Date.now() - lockStat.mtimeMs < staleAfterMs) return false;
    } catch {
      return true;
    }
  }

  const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    await rename(lockPath, stalePath);
    await rm(stalePath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (["ENOENT", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) return true;
    throw error;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquireOperationLock(
  name: string,
  options: OperationLockOptions = {}
): Promise<OperationLock> {
  const lockPath = options.lockPath ?? defaultLockPath();
  const maxWaitMs = options.maxWaitMs ?? 0;
  const pollMs = options.pollMs ?? 1_000;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const pid = options.pid ?? process.pid;
  const isProcessAlive = options.isProcessAlive ?? processIsAlive;
  const startedWaitingAt = Date.now();
  const owner: LockOwner = {
    pid,
    name,
    startedAt: new Date().toISOString(),
    token: randomUUID()
  };

  await mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath);
      try {
        await writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify(owner)}\n`, "utf8");
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      return {
        owner,
        release: async () => {
          const current = await readOwner(lockPath);
          if (current?.token === owner.token) {
            await rm(lockPath, { recursive: true, force: true });
          }
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    if (await recoverIfStale(lockPath, staleAfterMs, isProcessAlive)) continue;

    const current = await readOwner(lockPath);
    if (Date.now() - startedWaitingAt >= maxWaitMs) {
      throw new Error(`Operation blocked by ${current?.name ?? "another process"} (pid ${current?.pid ?? "unknown"}).`);
    }
    await wait(Math.min(pollMs, Math.max(1, maxWaitMs - (Date.now() - startedWaitingAt))));
  }
}

export async function runWithOperationLock<T>(
  name: string,
  operation: () => Promise<T>,
  options: OperationLockOptions = {}
): Promise<T> {
  const lock = await acquireOperationLock(name, options);
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}
