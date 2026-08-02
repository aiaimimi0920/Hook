import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hookRoot = process.cwd();
const workflowPath = resolve(hookRoot, ".github/workflows/signpath-signing.yml");
const versionScriptPath = resolve(hookRoot, "scripts/assert-release-version.ps1");
const auditScriptPath = resolve(hookRoot, "scripts/audit-open-source-dependencies.ps1");
const workflow = readFileSync(workflowPath, "utf8");
const versionScript = readFileSync(versionScriptPath, "utf8");
const auditScript = readFileSync(auditScriptPath, "utf8");

describe("Hook SignPath workflow contract", () => {
  it("keeps signing manual, GitHub-hosted, and protected by the release environment", () => {
    expect(existsSync(workflowPath)).toBe(true);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("push:");
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("environment: signpath-production");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("contents: write");
  });

  it("submits a GitHub artifact through the official SignPath action without repository PFX secrets", () => {
    expect(workflow).toContain("uses: actions/upload-artifact@v7");
    expect(workflow).toContain("id: upload-unsigned-artifact");
    expect(workflow).toContain("uses: signpath/github-action-submit-signing-request@v2");
    expect(workflow).toContain(
      "github-artifact-id: ${{ steps.upload-unsigned-artifact.outputs.artifact-id }}",
    );
    expect(workflow).toContain("SIGNPATH_API_TOKEN");
    expect(workflow).toContain("SIGNPATH_ORGANIZATION_ID");
    expect(workflow).toContain("SIGNPATH_PROJECT_SLUG");
    expect(workflow).toContain("SIGNPATH_SIGNING_POLICY_SLUG");
    expect(workflow).not.toContain("HOOK_WINDOWS_UIACCESS_PFX_BASE64");
    expect(workflow).not.toContain("HOOK_WINDOWS_UIACCESS_PFX_PASSWORD");
    expect(workflow).not.toContain("artifact-configuration-slug:");
  });

  it("builds the UIAccess payload only for signing and publishes only the returned signed package", () => {
    expect(workflow).toContain("-UiAccess");
    expect(workflow).toContain("-AllowUnsignedUiAccessBuild");
    expect(workflow).toContain("output-artifact-directory: release/Hook/uiaccess-signed");
    expect(workflow).toContain("package-uiaccess-installer-zip.ps1");
    expect(workflow).toContain("hook-windows-uiaccess-installer-${{ inputs.tag }}.zip");
    expect(workflow.indexOf("Submit SignPath signing request")).toBeLessThan(
      workflow.indexOf("Package signed UIAccess installer"),
    );
    expect(workflow.indexOf("Package signed UIAccess installer")).toBeLessThan(
      workflow.indexOf("Publish signed installer on the existing GitHub release"),
    );
  });

  it("checks release versions and open-source dependency metadata before signing", () => {
    expect(existsSync(versionScriptPath)).toBe(true);
    expect(existsSync(auditScriptPath)).toBe(true);
    expect(workflow).toContain("assert-release-version.ps1");
    expect(workflow).toContain("npm run audit:licenses");
    expect(workflow).toContain("run-rust-tests-ci.ps1");
    expect(versionScript).toContain("package-lock.json root package");
    expect(versionScript).toContain("src-tauri/tauri.conf.json");
    expect(auditScript).toContain("cargo metadata");
    expect(auditScript).toContain("PROPRIETARY");
  });
});
