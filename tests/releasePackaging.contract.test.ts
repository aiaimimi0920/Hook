import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("Otter release build scripts contract", () => {
  test("local build script defaults to sibling release/Otter and only produces the minimal exe payload", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const scriptPath = path.join(repoRoot, "scripts", "build-local-otter-exe.ps1");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(script).toMatch(/\.\.\\release\\Otter/);
    expect(script).toMatch(/npm run tauri build -- --no-bundle/i);
    expect(script).toMatch(/otter\.exe/i);
    expect(script).toMatch(/assert-release-version\.ps1/i);
    expect(script).not.toMatch(/payloadVariants/i);
    expect(script).not.toMatch(/release\\Otter\\full/i);
  });

  test("release packaging reads the executable from an explicit absolute Cargo target", () => {
    const script = fs.readFileSync(path.resolve(__dirname, "../scripts/build-local-otter-exe.ps1"), "utf8");
    expect(script).toContain('[System.IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)');
    expect(script).toContain('Join-Path ([System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR)) "release\\otter.exe"');
    expect(script).toContain('CARGO_TARGET_DIR must be absolute for release packaging.');
  });

  test("local build treats Tauri stderr progress as output and still fails on its exit code", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const scriptPath = path.join(repoRoot, "scripts", "build-local-otter-exe.ps1");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(script).toContain('$ErrorActionPreference = "Continue"');
    expect(script).toContain("$buildExitCode = $LASTEXITCODE");
    expect(script).toMatch(/if \(\$buildExitCode -ne 0\)/);
  });

  test("local build script falls back to a timestamped exe when release/Otter/otter.exe is locked", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const scriptPath = path.join(repoRoot, "scripts", "build-local-otter-exe.ps1");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(script).toMatch(/Get-Date -Format "yyyyMMdd-HHmmss"/i);
    expect(script).toMatch(/\$fallbackExe\s*=\s*Join-Path \$outputRoot/i);
    expect(script).toMatch(/Copy-Item -LiteralPath \$releaseExe -Destination \$fallbackExe -Force/i);
    expect(script).toMatch(/existing otter\.exe is locked/i);
  });

  test("package-otter-release.ps1 delegates to the Otter-local build script instead of the former parent-repo release script", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const scriptPath = path.join(repoRoot, "package-otter-release.ps1");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(script).toMatch(/build-local-otter-exe\.ps1/i);
    expect(script).not.toMatch(/build-release-exes\.ps1/i);
  });

  test("build-otter-release.bat remains a thin wrapper around package-otter-release.ps1", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const batchPath = path.join(repoRoot, "build-otter-release.bat");
    const script = fs.readFileSync(batchPath, "utf8");

    expect(script).toMatch(/package-otter-release\.ps1/i);
    expect(script).not.toMatch(/npm run tauri build -- --no-bundle/i);
    expect(script).not.toMatch(/src-tauri\\target\\release\\otter\.exe/i);
  });

  test("github actions workflow builds Otter on push and uploads the exe artifact", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const workflowPath = path.join(repoRoot, ".github", "workflows", "build-otter-exe.yml");
    const workflow = fs.readFileSync(workflowPath, "utf8");

    const workflowLines = workflow.split(/\r?\n/);
    expect(workflowLines.some((line) => /^on:\s*$/i.test(line))).toBe(true);
    expect(workflowLines.some((line) => /^\s+push:\s*$/i.test(line))).toBe(true);
    expect(workflow).toMatch(/workflow_dispatch:/i);
    expect(workflow).toMatch(/windows-latest/i);
    expect(workflow).toMatch(/build-local-otter-exe\.ps1/i);
    expect(workflow).toMatch(/upload-artifact/i);
    expect(workflow).toMatch(/otter\.exe/i);
  });
});
