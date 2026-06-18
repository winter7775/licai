import { describe, expect, it } from "vitest";
import { resolvePythonExecutable } from "./pythonRuntime";

describe("python runtime resolution", () => {
  it("uses explicit environment override first", () => {
    expect(resolvePythonExecutable({ env: { MINGYUAN_PYTHON: "/custom/python" }, platform: "linux", rootDir: "/app" })).toBe("/custom/python");
  });

  it("uses python3 on linux when no override is present", () => {
    expect(resolvePythonExecutable({ env: {}, platform: "linux", rootDir: "/app" })).toBe("python3");
  });
});
