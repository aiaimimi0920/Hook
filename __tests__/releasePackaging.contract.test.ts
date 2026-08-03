import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("Hook release build scripts contract", () => {
  test("local build script defaults to sibling release/Hook and only produces the minimal exe payload", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const scriptPath = path.join(repoRoot, "scripts", "build-local-hook-exe.ps1");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(script).toMatch(/\.\.\\release\\Hook/);
    expect(script).toMatch(/npm run tauri build -- --no-bundle/i);
    expect(script).toMatch(/hook\.exe/i);
    expect(script).toMatch(/assert-release-version\.ps1/i);
    expect(script).not.toMatch(/payloadVariants/i);
    expect(script).not.toMatch(/release\\Hook\\full/i);
  });

  test("local build script falls back to a timestamped exe when release/Hook/hook.exe is locked", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const scriptPath = path.join(repoRoot, "scripts", "build-local-hook-exe.ps1");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(script).toMatch(/Get-Date -Format "yyyyMMdd-HHmmss"/i);
    expect(script).toMatch(/\$fallbackExe\s*=\s*Join-Path \$outputRoot/i);
    expect(script).toMatch(/Copy-Item -LiteralPath \$releaseExe -Destination \$fallbackExe -Force/i);
    expect(script).toMatch(/existing hook\.exe is locked/i);
  });

  test("package-hook-release.ps1 delegates to the Hook-local build script instead of the former parent-repo release script", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const scriptPath = path.join(repoRoot, "package-hook-release.ps1");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(script).toMatch(/build-local-hook-exe\.ps1/i);
    expect(script).not.toMatch(/build-release-exes\.ps1/i);
  });

  test("build-hook-release.bat remains a thin wrapper around package-hook-release.ps1", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const batchPath = path.join(repoRoot, "build-hook-release.bat");
    const script = fs.readFileSync(batchPath, "utf8");

    expect(script).toMatch(/package-hook-release\.ps1/i);
    expect(script).not.toMatch(/npm run tauri build -- --no-bundle/i);
    expect(script).not.toMatch(/src-tauri\\target\\release\\hook\.exe/i);
  });

  test("github actions workflow builds Hook on push and uploads the exe artifact", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const workflowPath = path.join(repoRoot, ".github", "workflows", "build-hook-exe.yml");
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toMatch(/\bon:\s*(?:\r?\n\s+.*)*push:/i);
    expect(workflow).toMatch(/workflow_dispatch:/i);
    expect(workflow).toMatch(/windows-latest/i);
    expect(workflow).toMatch(/build-local-hook-exe\.ps1/i);
    expect(workflow).toMatch(/upload-artifact/i);
    expect(workflow).toMatch(/hook\.exe/i);
  });
});
