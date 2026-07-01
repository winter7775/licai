import path from "node:path";
import { existsSync } from "node:fs";

export function resolvePythonExecutable(options?: {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  rootDir?: string;
  existsSync?: (path: string) => boolean;
}): string {
  const env = options?.env ?? process.env;
  const platform = options?.platform ?? process.platform;
  const rootDir = options?.rootDir ?? process.cwd();
  const pathExists = options?.existsSync ?? existsSync;
  if (env.MINGYUAN_PYTHON) return env.MINGYUAN_PYTHON;
  if (env.PYTHON) return env.PYTHON;
  if (platform === "win32") {
    const bundled = path.resolve(rootDir, ".codex_tmp/whisper-venv/Scripts/python.exe");
    return pathExists(bundled) ? bundled : "python";
  }
  return "python3";
}
