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
});
