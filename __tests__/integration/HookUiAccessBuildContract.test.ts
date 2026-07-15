import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const hookRoot = process.cwd();
const buildRsPath = resolve(hookRoot, "src-tauri/build.rs");
const uiAccessManifestPath = resolve(hookRoot, "src-tauri/windows/uiaccess.manifest.xml");
const localBuildScriptPath = resolve(hookRoot, "scripts/build-local-hook-exe.ps1");
const uiAccessInstallScriptPath = resolve(hookRoot, "scripts/install-hook-uiaccess.ps1");
const localUiAccessSetupScriptPath = resolve(hookRoot, "scripts/setup-hook-uiaccess-local-test.ps1");

const buildRsSource = readFileSync(buildRsPath, "utf8");
const localBuildScriptSource = readFileSync(localBuildScriptPath, "utf8");
const uiAccessManifestExists = existsSync(uiAccessManifestPath);
const uiAccessManifestSource = uiAccessManifestExists
  ? readFileSync(uiAccessManifestPath, "utf8")
  : "";
const uiAccessInstallScriptExists = existsSync(uiAccessInstallScriptPath);
const uiAccessInstallScriptSource = uiAccessInstallScriptExists
  ? readFileSync(uiAccessInstallScriptPath, "utf8")
  : "";
const localUiAccessSetupScriptExists = existsSync(localUiAccessSetupScriptPath);
const localUiAccessSetupScriptSource = localUiAccessSetupScriptExists
  ? readFileSync(localUiAccessSetupScriptPath, "utf8")
  : "";

describe("Hook UIAccess build contract", () => {
  it("allows the Rust build script to opt into a custom UIAccess Windows manifest for elevated-foreground interoperability", () => {
    expect(buildRsSource).toContain("HOOK_WINDOWS_UIACCESS");
    expect(buildRsSource).toContain("tauri_build::Attributes::new()");
    expect(buildRsSource).toContain("tauri_build::WindowsAttributes::new()");
    expect(buildRsSource).toContain('include_str!("windows/uiaccess.manifest.xml")');
    expect(buildRsSource).toContain("windows_attributes");
    expect(buildRsSource).toContain("tauri_build::try_build");
  });

  it("ships an explicit UIAccess manifest that stays asInvoker while requesting uiAccess privileges", () => {
    expect(uiAccessManifestExists).toBe(true);
    expect(uiAccessManifestSource).toContain("<assembly");
    expect(uiAccessManifestSource).toContain("requestedExecutionLevel");
    expect(uiAccessManifestSource).toContain('level="asInvoker"');
    expect(uiAccessManifestSource).toContain('uiAccess="true"');
    expect(uiAccessManifestSource).toContain("Microsoft.Windows.Common-Controls");
  });

  it("lets the local build script produce a UIAccess-ready exe variant without changing the default portable build", () => {
    expect(localBuildScriptSource).toContain("[switch]$UiAccess");
    expect(localBuildScriptSource).toContain("[switch]$AllowUnsignedUiAccessBuild");
    expect(localBuildScriptSource).toContain("HOOK_WINDOWS_UIACCESS");
    expect(localBuildScriptSource).toContain("npm run tauri build -- --no-bundle");
    expect(localBuildScriptSource).toContain("uiAccess");
    expect(localBuildScriptSource).toContain("trusted location");
    expect(localBuildScriptSource).toContain("digitally signed");
    expect(localBuildScriptSource).toContain("A referral was returned from the server");
  });

  it("includes an install helper that stages the signed UIAccess build into Program Files instead of pretending a loose unsigned exe can cross UIPI", () => {
    expect(uiAccessInstallScriptExists).toBe(true);
    expect(uiAccessInstallScriptSource).toContain("Program Files");
    expect(uiAccessInstallScriptSource).toContain("uiAccess");
    expect(uiAccessInstallScriptSource).toContain("digitally signed");
    expect(uiAccessInstallScriptSource).toContain("trusted location");
    expect(uiAccessInstallScriptSource).toContain("hook.exe");
  });

  it("includes a local one-shot setup helper that can create a trusted self-signed code-signing certificate, sign the UIAccess exe, and install it into Program Files for real non-admin testing", () => {
    expect(localUiAccessSetupScriptExists).toBe(true);
    expect(localUiAccessSetupScriptSource).toContain("New-SelfSignedCertificate");
    expect(localUiAccessSetupScriptSource).toContain("CodeSigningCert");
    expect(localUiAccessSetupScriptSource).toContain("Cert:\\LocalMachine\\My");
    expect(localUiAccessSetupScriptSource).toContain("Cert:\\LocalMachine\\Root");
    expect(localUiAccessSetupScriptSource).toContain("TrustedPublisher");
    expect(localUiAccessSetupScriptSource).toContain("Set-AuthenticodeSignature");
    expect(localUiAccessSetupScriptSource).toContain("build-local-hook-exe.ps1");
    expect(localUiAccessSetupScriptSource).toContain("-UiAccess");
    expect(localUiAccessSetupScriptSource).toContain("-AllowUnsignedUiAccessBuild");
    expect(localUiAccessSetupScriptSource).toContain("install-hook-uiaccess.ps1");
    expect(localUiAccessSetupScriptSource).toContain("Program Files");
  });
});
