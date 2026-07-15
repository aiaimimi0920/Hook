import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const hookRoot = process.cwd();
const buildWorkflowPath = resolve(hookRoot, ".github/workflows/build-hook-exe.yml");
const releaseWorkflowPath = resolve(hookRoot, ".github/workflows/release-hook-tag.yml");
const installerPackageScriptPath = resolve(
  hookRoot,
  "scripts/package-uiaccess-installer-zip.ps1",
);
const distributionDocPath = resolve(hookRoot, "UIACCESS_DISTRIBUTION.md");
const releaseStrategyDocPath = resolve(hookRoot, "docs/RELEASE_STRATEGY.md");
const readmePath = resolve(hookRoot, "README.md");
const readmeZhPath = resolve(hookRoot, "README.zh-CN.md");

const buildWorkflowSource = readFileSync(buildWorkflowPath, "utf8");
const releaseWorkflowSource = readFileSync(releaseWorkflowPath, "utf8");
const installerPackageScriptExists = existsSync(installerPackageScriptPath);
const installerPackageScriptSource = installerPackageScriptExists
  ? readFileSync(installerPackageScriptPath, "utf8")
  : "";
const distributionDocExists = existsSync(distributionDocPath);
const distributionDocSource = distributionDocExists
  ? readFileSync(distributionDocPath, "utf8")
  : "";
const releaseStrategyDocExists = existsSync(releaseStrategyDocPath);
const releaseStrategyDocSource = releaseStrategyDocExists
  ? readFileSync(releaseStrategyDocPath, "utf8")
  : "";
const readmeSource = readFileSync(readmePath, "utf8");
const readmeZhSource = readFileSync(readmeZhPath, "utf8");

describe("Hook dual distribution contract", () => {
  it("keeps portable builds as the only current public GitHub Actions artifact while preserving installer packaging scripts in-repo for a future signed phase", () => {
    expect(buildWorkflowSource).toContain("hook-portable-windows-x64");
    expect(buildWorkflowSource).not.toContain("hook-uiaccess-installer-windows-x64");
    expect(buildWorkflowSource).not.toContain("HOOK_WINDOWS_UIACCESS_PFX_BASE64");
    expect(buildWorkflowSource).not.toContain("HOOK_WINDOWS_UIACCESS_PFX_PASSWORD");
    expect(buildWorkflowSource).not.toContain("package-uiaccess-installer-zip.ps1");
  });

  it("publishes only the portable tag-release asset in the current phase while keeping the future installer asset contract out of the active release workflow", () => {
    expect(releaseWorkflowSource).toContain("hook-windows-x64-${{ env.HOOK_TAG }}.zip");
    expect(releaseWorkflowSource).toContain("package-release-zip.ps1");
    expect(releaseWorkflowSource).not.toContain("hook-windows-uiaccess-installer-${{ env.HOOK_TAG }}.zip");
    expect(releaseWorkflowSource).not.toContain("package-uiaccess-installer-zip.ps1");
    expect(releaseWorkflowSource).not.toContain("HOOK_WINDOWS_UIACCESS_PFX_BASE64");
    expect(releaseWorkflowSource).not.toContain("HOOK_WINDOWS_UIACCESS_PFX_PASSWORD");
  });

  it("ships a dedicated installer packaging script that stages the signed uiAccess exe together with the install helper instead of only zipping hook.exe", () => {
    expect(installerPackageScriptExists).toBe(true);
    expect(installerPackageScriptSource).toContain("hook-windows-uiaccess-installer-");
    expect(installerPackageScriptSource).toContain("install-hook-uiaccess.ps1");
    expect(installerPackageScriptSource).toContain("hook.exe");
    expect(installerPackageScriptSource).toContain("Compress-Archive");
    expect(installerPackageScriptSource).toContain("Program Files");
  });

  it("documents the current portable-first phase, the administrator-launch workaround, and the future signed-installer phase", () => {
    expect(distributionDocExists).toBe(true);
    expect(releaseStrategyDocExists).toBe(true);
    expect(distributionDocSource).toContain("UIAccess");
    expect(distributionDocSource).toContain("Program Files");
    expect(distributionDocSource).toContain("portable");
    expect(distributionDocSource).toContain("Task Manager");
    expect(distributionDocSource).toContain("administrator");
    expect(distributionDocSource).toContain("current phase");
    expect(distributionDocSource).toContain("future");

    expect(releaseStrategyDocSource).toContain("portable-first");
    expect(releaseStrategyDocSource).toContain("signed-installer");
    expect(releaseStrategyDocSource).toContain("GitHub Actions");
    expect(readmeSource).toContain("Portable");
    expect(readmeSource).toContain("administrator");
    expect(readmeSource).toContain("future signed releases");
    expect(readmeSource).toContain("Portable");
    expect(readmeSource).toContain("Task Manager");
    expect(readmeZhSource).toContain("安装版");
    expect(readmeZhSource).toContain("便携版");
    expect(readmeZhSource).toContain("任务管理器");
    expect(readmeZhSource).toContain("管理员身份");
  });
});
