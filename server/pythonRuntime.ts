import path from "node:path";

export function resolvePythonExecutable(options?: {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  rootDir?: string;
}): string {
  const env = options?.env ?? process.env;
  const platform = options?.platform ?? process.platform;
  const rootDir = options?.rootDir ?? process.cwd();
  if (env.MINGYUAN_PYTHON) return env.MINGYUAN_PYTHON;
  if (env.PYTHON) return env.PYTHON;
  if (platform === "win32") return path.resolve(rootDir, ".codex_tmp/whisper-venv/Scripts/python.exe");
  return "python3";
}
