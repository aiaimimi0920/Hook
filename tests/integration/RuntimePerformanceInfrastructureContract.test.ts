import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const otterRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(resolve(otterRoot, relativePath), "utf8");

describe("runtime performance infrastructure contract", () => {
  it("keeps the stable serial lane and adds an independent parallel race lane", () => {
    const packageJson = JSON.parse(readSource("package.json")) as {
      scripts: Record<string, string>;
    };
    const workflow = readSource(".github/workflows/build-otter-exe.yml");

    expect(packageJson.scripts.test).toContain("--maxWorkers 1");
    expect(packageJson.scripts.test).toContain("--no-file-parallelism");
    expect(packageJson.scripts["test:parallel"]).toContain("--maxWorkers 4");
    expect(workflow).toContain("build-windows-exe:");
    expect(workflow).toContain("parallel-race:");
    expect(workflow).toContain("npm run test:parallel");
    expect(workflow).toContain("cargo test --manifest-path src-tauri/Cargo.toml");
  });

  it("provides executable frame, queue, memory, shader, and real-process soak gates", () => {
    const performanceTestPath = resolve(
      otterRoot,
      "tests/performance/RuntimePerformanceGates.test.ts",
    );
    const soakScriptPath = resolve(otterRoot, "scripts/run-otter-runtime-soak.ps1");
    const workflowPath = resolve(otterRoot, ".github/workflows/runtime-performance.yml");
    const shaderRunner = readSource("scripts/run-shader-benchmark.mjs");

    expect(existsSync(performanceTestPath)).toBe(true);
    expect(existsSync(soakScriptPath)).toBe(true);
    expect(existsSync(workflowPath)).toBe(true);
    expect(readSource("package.json")).toContain('"test:performance"');
    expect(readSource("src/features/live/services/liveEraseQueue.ts")).toContain("maxPendingPoints");
    expect(readSource("src/features/live/services/liveEraseQueue.ts")).toContain("getMetrics()");
    expect(shaderRunner).toContain("HOOK_SHADER_BENCH_ENFORCE");
    expect(shaderRunner).toContain("Shader performance budget failed");
    expect(readSource(".github/workflows/runtime-performance.yml")).toContain(
      "run-otter-runtime-soak.ps1",
    );
  });
});
