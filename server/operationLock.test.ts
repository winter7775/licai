import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireOperationLock, runWithOperationLock } from "./operationLock";

const tempDirs: string[] = [];

async function tempLockPath(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mingyuan-operation-lock-"));
  tempDirs.push(root);
  return path.join(root, "operation.lock");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("operation lock", () => {
  it("holds an atomic lock for the full operation and releases it afterwards", async () => {
    const lockPath = await tempLockPath();

    await runWithOperationLock(
      "daily-job",
      async () => {
        const owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
        expect(owner.name).toBe("daily-job");
        expect(owner.pid).toBe(process.pid);
        await expect(acquireOperationLock("backtest", { lockPath })).rejects.toThrow(/daily-job/);
      },
      { lockPath }
    );

    const next = await acquireOperationLock("backtest", { lockPath });
    await next.release();
  });

  it("recovers a lock whose owner process is no longer alive", async () => {
    const lockPath = await tempLockPath();
    const stale = await acquireOperationLock("stale-job", {
      lockPath,
      pid: 999_999,
      isProcessAlive: () => false
    });

    const recovered = await acquireOperationLock("daily-job", {
      lockPath,
      isProcessAlive: () => false
    });
    const owner = JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
    expect(owner.name).toBe("daily-job");

    await stale.release();
    expect(JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8")).name).toBe("daily-job");
    await recovered.release();
  });
});
