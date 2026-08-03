import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const hookRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(resolve(hookRoot, relativePath), "utf8");

describe("release provenance contract", () => {
  it("validates release versions and protected-branch ancestry before expensive build steps", () => {
    const releaseWorkflow = readSource(".github/workflows/release-hook-tag.yml");
    const buildWorkflow = readSource(".github/workflows/build-hook-exe.yml");
    const versionScript = readSource("scripts/assert-release-version.ps1");

    expect(versionScript).toContain("git merge-base --is-ancestor");
    expect(versionScript).toContain("Hook product version must use strict SemVer X.Y.Z");
    expect(releaseWorkflow).toContain("-RequireReachableFromBranch \"origin/main\"");
    expect(releaseWorkflow.indexOf("Verify release provenance and product versions")).toBeLessThan(
      releaseWorkflow.indexOf("Install npm dependencies"),
    );
    expect(buildWorkflow.indexOf("Validate product versions before build setup")).toBeLessThan(
      buildWorkflow.indexOf("Install npm dependencies"),
    );
  });

  it("binds SignPath submission to the public reviewed digest and original workflow run", () => {
    const releaseWorkflow = readSource(".github/workflows/release-hook-tag.yml");
    const signingWorkflow = readSource(".github/workflows/signpath-signing.yml");

    expect(releaseWorkflow).toContain("Create signing candidate digest manifest");
    expect(releaseWorkflow).toContain("runId = \"${{ github.run_id }}\"");
    expect(signingWorkflow).toContain("candidate_run_id:");
    expect(signingWorkflow).toContain("reviewed_sha256:");
    expect(signingWorkflow).toContain("run-id: ${{ inputs.candidate_run_id }}");
    expect(signingWorkflow).toContain("gh release download");
    expect(signingWorkflow).toContain("assert-reviewed-signing-candidate.ps1");
    expect(releaseWorkflow).toContain("Get-HookFileSha256");
    expect(signingWorkflow).toContain("Get-HookFileSha256");
    expect(releaseWorkflow).not.toContain("Get-FileHash");
    expect(signingWorkflow).not.toContain("Get-FileHash");
    expect(signingWorkflow.indexOf("Verify reviewed candidate digest and provenance")).toBeLessThan(
      signingWorkflow.indexOf("Submit SignPath signing request"),
    );
  });

  it("rejects a signing candidate when the reviewed digest does not match", () => {
    const root = mkdtempSync(join(tmpdir(), "hook-signing-candidate-"));
    try {
      const exePath = join(root, "hook.exe");
      const manifestPath = join(root, "manifest.json");
      const bytes = Buffer.from("reviewed Hook candidate", "utf8");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      writeFileSync(exePath, bytes);
      writeFileSync(manifestPath, JSON.stringify({
        schemaVersion: 1,
        artifact: "hook.exe",
        tag: "V0.1.6",
        commit: "0123456789abcdef0123456789abcdef01234567",
        runId: "12345",
        sha256,
      }));

      const script = resolve(hookRoot, "scripts/assert-reviewed-signing-candidate.ps1");
      const baseArgs = [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", script,
        "-ExePath", exePath,
        "-ManifestPath", manifestPath,
        "-ExpectedTag", "V0.1.6",
        "-ExpectedCommit", "0123456789abcdef0123456789abcdef01234567",
        "-ExpectedRunId", "12345",
      ];
      const accepted = spawnSync(
        "powershell.exe",
        [...baseArgs, "-ReviewedSha256", sha256],
        { encoding: "utf8" },
      );
      expect(accepted.status, accepted.stderr || accepted.stdout).toBe(0);

      const rejected = spawnSync(
        "powershell.exe",
        [...baseArgs, "-ReviewedSha256", "0".repeat(64)],
        { encoding: "utf8" },
      );
      expect(rejected.status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
