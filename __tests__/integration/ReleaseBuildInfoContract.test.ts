import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const releaseScriptSource = readFileSync(
  resolve(process.cwd(), "..", "scripts", "build-release-exes.ps1"),
  "utf8",
);

describe("release build info contract", () => {
  it("labels BUILD_INFO.txt with the selected app instead of hard-coding Loom", () => {
    expect(releaseScriptSource).toContain('$($Spec["app"]) Windows release artifact');
    expect(releaseScriptSource).not.toContain("Loom Windows release artifact");
  });
});
