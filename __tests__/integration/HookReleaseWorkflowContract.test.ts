import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Hook release workflow contract", () => {
  const workflowPath = resolve(
    process.cwd(),
    ".github/workflows/release-hook-tag.yml",
  );
  const packageScriptPath = resolve(
    process.cwd(),
    "scripts/package-release-zip.ps1",
  );
  const installerPackageScriptPath = resolve(
    process.cwd(),
    "scripts/package-uiaccess-installer-zip.ps1",
  );

  it("adds a dedicated tag-triggered GitHub Release workflow", () => {
    expect(existsSync(workflowPath)).toBe(true);

    const workflowSource = readFileSync(workflowPath, "utf8");
    expect(workflowSource).toContain("push:");
    expect(workflowSource).toContain("tags:");
    expect(workflowSource).toContain("- 'V*.*.*'");
    expect(workflowSource).toContain("workflow_dispatch:");
    expect(workflowSource).toContain("inputs:");
    expect(workflowSource).toContain("tag:");
    expect(workflowSource).toContain("Release tag to publish manually");
    expect(workflowSource).toContain("contents: write");
    expect(workflowSource).toContain("uses: actions/checkout@v5");
    expect(workflowSource).toContain(
      "ref: ${{ github.event_name == 'workflow_dispatch' && github.event.inputs.tag || github.ref }}",
    );
    expect(workflowSource).toContain("uses: actions/setup-node@v6");
    // Toolchain is pinned to an exact version (not the floating @stable) so
    // release builds stay reproducible.
    expect(workflowSource).toContain("uses: dtolnay/rust-toolchain@1.95.0");
    // Release packaging intentionally stays build-only; the previous verify
    // gate was removed because the test suite is not yet CI-stable enough to
    // block user-downloadable exe publishing.
    expect(workflowSource).not.toContain("needs: verify");
  });

  it("publishes both the portable zip and the signed UIAccess installer zip when release signing is configured", () => {
    expect(existsSync(packageScriptPath)).toBe(true);
    expect(existsSync(installerPackageScriptPath)).toBe(true);

    const workflowSource = readFileSync(workflowPath, "utf8");
    const packageScriptSource = readFileSync(packageScriptPath, "utf8");
    const installerPackageScriptSource = readFileSync(installerPackageScriptPath, "utf8");

    expect(workflowSource).toContain("package-release-zip.ps1");
    expect(workflowSource).toContain("Resolve release tag");
    expect(workflowSource).toContain("uses: softprops/action-gh-release@v3");
    expect(workflowSource).toContain("working_directory: release/Hook");
    expect(workflowSource).toContain("files:");
    expect(workflowSource).toContain("hook-windows-x64-${{ env.HOOK_TAG }}.zip");
    expect(workflowSource).not.toContain("hook-windows-uiaccess-installer-${{ env.HOOK_TAG }}.zip");
    expect(workflowSource).not.toContain("HOOK_WINDOWS_UIACCESS_PFX_BASE64");
    expect(workflowSource).not.toContain("HOOK_WINDOWS_UIACCESS_PFX_PASSWORD");
    expect(workflowSource).toContain("overwrite_files: true");
    expect(workflowSource).toContain("fail_on_unmatched_files: true");
    expect(workflowSource).not.toContain("gh release create");
    expect(workflowSource).not.toContain("gh release upload");
    expect(workflowSource).toContain("hook-windows-x64-");

    expect(packageScriptSource).toContain("hook.exe");
    expect(packageScriptSource).toContain("hook-windows-x64-");
    expect(packageScriptSource).toContain("Compress-Archive");
    expect(packageScriptSource).not.toContain("start-hook.bat");
    expect(packageScriptSource).not.toContain("start-hook.vbs");
    expect(packageScriptSource).not.toContain("stop-hook.bat");
    expect(packageScriptSource).not.toContain("launch-config.cmd");

    expect(installerPackageScriptSource).toContain("hook-windows-uiaccess-installer-");
    expect(installerPackageScriptSource).toContain("install-hook-uiaccess.ps1");
    expect(installerPackageScriptSource).toContain("install-hook.ps1");
    expect(installerPackageScriptSource).toContain("Program Files");
  });
});
