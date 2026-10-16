import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as {
  scripts: Record<string, string>;
};

describe("Otter developer entrypoints contract", () => {
  it("uses package.json for the local verification gate and drops one-off wrapper launchers", () => {
    const otterRoot = process.cwd();
    const verifyWrapperPath = resolve(otterRoot, "verify-otter-full.bat");
    const captureWrapperPath = resolve(otterRoot, "start-otter-capture-test.bat");
    const readme = readFileSync(resolve(otterRoot, "README.md"), "utf8");
    const docsIndex = readFileSync(resolve(otterRoot, "docs/README.md"), "utf8");
    const developmentGuide = readFileSync(resolve(otterRoot, "docs/guide/development.md"), "utf8");
    const verifyScript = packageJson.scripts["verify:local"] ?? "";

    expect(existsSync(verifyWrapperPath)).toBe(false);
    expect(existsSync(captureWrapperPath)).toBe(false);

    expect(verifyScript).toContain("npm run typecheck");
    expect(verifyScript).toContain("npm test");
    expect(verifyScript).toContain("cargo fmt --check");
    expect(verifyScript).toContain("cargo test");
    expect(verifyScript).toContain("npm run build");
    expect(verifyScript).toContain("build-otter-release.bat");
    expect(verifyScript.indexOf("npm run typecheck")).toBeLessThan(
      verifyScript.indexOf("npm test"),
    );
    expect(verifyScript.indexOf("npm test")).toBeLessThan(
      verifyScript.indexOf("cargo fmt --check"),
    );
    expect(verifyScript.indexOf("cargo fmt --check")).toBeLessThan(
      verifyScript.indexOf("cargo test"),
    );
    expect(verifyScript.indexOf("cargo test")).toBeLessThan(
      verifyScript.indexOf("npm run build"),
    );
    expect(verifyScript.indexOf("npm run build")).toBeLessThan(
      verifyScript.indexOf("build-otter-release.bat"),
    );

    expect(readme).toContain("./docs/README.md");
    expect(docsIndex).toContain("guide/development.md");
    expect(developmentGuide).toContain("npm run verify:local");
    expect(developmentGuide).not.toContain("verify-otter-full.bat");
    expect(developmentGuide).not.toContain("start-otter-capture-test.bat");
    expect(developmentGuide).not.toContain("scripts\\run-vitest.cmd");
    expect(readme).not.toContain("verify-otter-full.bat");
    expect(readme).not.toContain("start-otter-capture-test.bat");
  });
});
