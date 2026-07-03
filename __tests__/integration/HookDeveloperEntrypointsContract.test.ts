import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as {
  scripts: Record<string, string>;
};

describe("Hook developer entrypoints contract", () => {
  it("uses package.json for the local verification gate and drops one-off wrapper launchers", () => {
    const hookRoot = process.cwd();
    const verifyWrapperPath = resolve(hookRoot, "verify-hook-full.bat");
    const captureWrapperPath = resolve(hookRoot, "start-hook-capture-test.bat");
    const readme = readFileSync(resolve(hookRoot, "README.md"), "utf8");
    const verifyScript = packageJson.scripts["verify:local"] ?? "";

    expect(existsSync(verifyWrapperPath)).toBe(false);
    expect(existsSync(captureWrapperPath)).toBe(false);

    expect(verifyScript).toContain("npm run typecheck");
    expect(verifyScript).toContain("npm test");
    expect(verifyScript).toContain("npm run build");
    expect(verifyScript).toContain("build-hook-release.bat");
    expect(verifyScript.indexOf("npm run typecheck")).toBeLessThan(
      verifyScript.indexOf("npm test"),
    );
    expect(verifyScript.indexOf("npm test")).toBeLessThan(
      verifyScript.indexOf("npm run build"),
    );
    expect(verifyScript.indexOf("npm run build")).toBeLessThan(
      verifyScript.indexOf("build-hook-release.bat"),
    );

    expect(readme).toContain("npm run verify:local");
    expect(readme).not.toContain("verify-hook-full.bat");
    expect(readme).not.toContain("start-hook-capture-test.bat");
  });
});
