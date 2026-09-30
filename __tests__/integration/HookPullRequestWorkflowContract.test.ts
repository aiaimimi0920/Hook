// Pull requests must receive the same Windows source gates without release authority.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Hook pull request workflow contract", () => {
  const source = readFileSync(resolve(process.cwd(), ".github/workflows/build-hook-exe.yml"), "utf8");

  it("tests pull requests with read-only repository access and ephemeral checkout credentials", () => {
    expect(source).toMatch(/^  pull_request:\s*$/m);
    expect(source).not.toContain("pull_request_target:");
    expect(source).toContain("permissions:\n  contents: read");
    expect(source).not.toMatch(/^\s+[\w-]+: write$/m);
    expect(source).not.toContain("secrets.");
    expect(source.match(/persist-credentials: false/g)).toHaveLength(2);
    expect(source.match(/runs-on: windows-latest/g)).toHaveLength(2);
    expect(source.match(/actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/g)).toHaveLength(2);
  });

  it("preserves blocking dependency, source, browser and native checks without publication", () => {
    for (const gate of [
      "Test-DependencySecurityContract.ps1", "npm run test:effective-lines",
      "npm run check:effective-lines", "npm run audit:licenses", "npm run lint",
      "npm run typecheck", "npm run typecheck:test", "npm test",
      "cargo fmt --check", "run-rust-tests-ci.ps1", "npm run test:parallel",
      "npm run test:performance", "npm run test:surface-browser", "cargo test",
    ]) expect(source).toContain(gate);
    expect(source).not.toContain("continue-on-error:");
    expect(source).not.toMatch(/action-gh-release|signpath|id-token:|attestations:|gh release/);
  });
});
