import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

type TsConfig = {
  compilerOptions?: {
    types?: string[];
  };
};

describe("Hook frontend stack contract", () => {
  it("uses a Vite-only frontend toolchain without the deprecated SolidStart/Vinxi chain", () => {
    const hookRoot = process.cwd();
    const packageJson = JSON.parse(
      readFileSync(resolve(hookRoot, "package.json"), "utf8"),
    ) as PackageJson;
    const tsconfig = JSON.parse(
      readFileSync(resolve(hookRoot, "tsconfig.json"), "utf8"),
    ) as TsConfig;
    const packageLock = readFileSync(resolve(hookRoot, "package-lock.json"), "utf8");

    expect(packageJson.dependencies ?? {}).not.toHaveProperty("@solidjs/router");
    expect(packageJson.dependencies ?? {}).not.toHaveProperty("@solidjs/start");
    expect(packageJson.dependencies ?? {}).not.toHaveProperty("vinxi");
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty("@solidjs/router");
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty("@solidjs/start");
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty("vinxi");

    expect(packageJson.scripts?.dev ?? "").not.toContain("run-vinxi");
    expect(packageJson.scripts?.build ?? "").not.toContain("run-vinxi");
    expect(packageJson.scripts?.start ?? "").not.toContain("run-vinxi");

    expect(existsSync(resolve(hookRoot, "vite.config.ts"))).toBe(true);
    expect(existsSync(resolve(hookRoot, "index.html"))).toBe(true);
    expect(existsSync(resolve(hookRoot, "src/main.tsx"))).toBe(true);
    expect(existsSync(resolve(hookRoot, "app.config.ts"))).toBe(false);
    expect(existsSync(resolve(hookRoot, "scripts/run-vinxi.cmd"))).toBe(false);

    expect(tsconfig.compilerOptions?.types ?? []).toContain("vite/client");
    expect(tsconfig.compilerOptions?.types ?? []).not.toContain("vinxi/types/client");

    expect(packageLock).not.toContain('"@solidjs/router"');
    expect(packageLock).not.toContain('"@solidjs/start"');
    expect(packageLock).not.toContain('"vinxi"');
    expect(packageLock).not.toContain('"dax-sh"');
  });
});
