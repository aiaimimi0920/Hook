import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as {
  scripts: Record<string, string>;
};

describe("Hook test entrypoint contract", () => {
  it("runs Vitest directly from package.json without a dedicated batch wrapper", () => {
    const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
    const vitestWrapperPath = resolve(process.cwd(), "scripts", "run-vitest.cmd");

    expect(packageJson.scripts.test).toContain("vitest.cmd run");
    expect(packageJson.scripts["test:watch"]).toContain("vitest.cmd watch");
    expect(existsSync(vitestWrapperPath)).toBe(false);
    expect(readme).not.toContain("scripts\\run-vitest.cmd");
  });

  it("partitions the wall-clock gate out of parallel tests without excluding functional files", () => {
    const parallel = packageJson.scripts["test:parallel"];
    const performance = packageJson.scripts["test:performance"];
    const performanceFile = performance.match(/vitest\.cmd run (\S+)/)?.[1].replaceAll("\\", "/");
    const excluded = [...parallel.matchAll(/--exclude (\S+)/g)].map((match) => match[1]);
    expect(performanceFile).toBe("__tests__/performance/RuntimePerformanceGates.test.ts");
    expect(excluded).toEqual([performanceFile]);
    expect(parallel).toContain("--maxWorkers 4 --fileParallelism");
    expect(performance).toContain("--maxWorkers 1 --no-file-parallelism");
    expect(packageJson.scripts.test).not.toContain("--exclude");
  });

  it("keeps the same isolated performance gate and serial packaging gate blocking CI", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/build-hook-exe.yml"), "utf8");
    const boundary = workflow.indexOf("\n  parallel-race:");
    expect(boundary).toBeGreaterThan(0);
    const parallelJob = workflow.slice(boundary);
    expect(parallelJob).toContain("run: npm run test:parallel");
    expect(parallelJob.indexOf("run: npm run test:performance"))
      .toBeGreaterThan(parallelJob.indexOf("run: npm run test:parallel"));
    expect(parallelJob).not.toContain("continue-on-error:");
    const serialJob = workflow.slice(0, boundary);
    expect(serialJob).toContain("run: npm test");
    expect(serialJob.indexOf("name: Build portable Hook EXE"))
      .toBeGreaterThan(serialJob.indexOf("run: npm test"));
    expect(serialJob).not.toContain("continue-on-error:");
  });
});
