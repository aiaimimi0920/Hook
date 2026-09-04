import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook native candidate acceptance contract", () => {
  it("approves the isolated pending Hook device before the real Surface probe", () => {
    const scriptPaths = [
      resolve(process.cwd(), "scripts", "Invoke-HookNativeCandidateAcceptance.ps1"),
      resolve(process.cwd(), "scripts", "native-candidate-acceptance", "summary-process-wait.ps1"),
      resolve(process.cwd(), "scripts", "native-candidate-acceptance", "probe-lifecycle.ps1"),
    ];
    const script = scriptPaths.map((filePath) => readFileSync(filePath, "utf8")).join("\n");
    const instantiate = script.indexOf("$instantiated = Invoke-JsonPost");
    const approval = script.indexOf("$pairing = Wait-AndApprovePendingHookDevice", instantiate);
    const surfaceProbe = script.indexOf("$surfaceProbe = Invoke-NativeProbe", approval);

    expect(script).toContain("function Wait-AndApprovePendingHookDevice");
    expect(script).toContain('artId = "neuro.official/surface-device-dashboard"');
    expect(script).toContain('type = "artNode"');
    expect(script).not.toContain('artId = "surface-device-dashboard"');
    expect(script).toContain('/v1/devices/$encodedDeviceId/approve');
    expect(script).toContain('[string]$device.approval -ne "pending"');
    expect(script).toContain('[string]$_.approval -eq "approved"');
    expect(script).toContain('[string]$_.id -eq "device-000-local"');
    expect(script).toContain('$_.isLocal -eq $true');
    expect(script).toContain("isolated Loom reported multiple protected local devices");
    expect(script).toContain("isolated Loom reported a protected local device and unexpected pending Hook devices");
    expect(script).toContain('$cleanupNeedle = "hook_process_exit_cleanup :: reason=tauri_"');
    expect(instantiate).toBeGreaterThanOrEqual(0);
    expect(approval).toBeGreaterThan(instantiate);
    expect(surfaceProbe).toBeGreaterThan(approval);
    expect(script.slice(approval, surfaceProbe)).not.toContain("instantiate-workflow");
  });

  it("defaults to the image-search runtime-fix R18/R28 pair and validates both expected digests", () => {
    const nativeScript = readFileSync(
      resolve(process.cwd(), "scripts", "Invoke-HookNativeCandidateAcceptance.ps1"),
      "utf8",
    );
    const pairedScript = readFileSync(
      resolve(process.cwd(), "scripts", "Invoke-HookLoomSurfaceCandidateAcceptance.ps1"),
      "utf8",
    );
    const hookSha = "9f514b1a61f21bd337e40dd890f471c8cba400cde29c3a2e85a717baa148b72b";
    const daemonSha = "0258a54a65b2e0530a39d010af1df8e4361773df43d33b342a68a6be1f1b7a96";

    expect(nativeScript).toContain("20260814-image-search-runtime-fix-r18");
    expect(nativeScript).toContain("[ValidatePattern('^[0-9A-Fa-f]{64}$')]");
    expect(nativeScript).toContain(`[string]$ExpectedSha256 = "${hookSha}"`);
    expect(nativeScript).toContain("if ($actualSha256 -ne $ExpectedSha256.Trim().ToLowerInvariant())");
    expect(pairedScript).toContain("20260814-image-search-runtime-fix-r18");
    expect(pairedScript).toContain("20260814-image-search-runtime-fix-r28");
    expect(pairedScript).toContain(`[string]$ExpectedHookSha256 = "${hookSha}"`);
    expect(pairedScript).toContain(`[string]$ExpectedLoomDaemonSha256 = "${daemonSha}"`);
    expect(pairedScript.match(/\[ValidatePattern\('\^\[0-9A-Fa-f\]\{64\}\$'\)\]/g)).toHaveLength(2);
    expect(pairedScript).toContain('$innerArgs += @("-ExpectedSha256", $ExpectedHookSha256)');
    expect(pairedScript).toContain(
      '$artInstall = Invoke-JsonPost -Uri "$daemonBaseUrl/v1/arts/store/install" -Body @{ artId = "surface-device-dashboard" }',
    );
    expect(`${nativeScript}\n${pairedScript}`).not.toContain("20260811-distributed-art-surface-r8");
    expect(pairedScript).not.toContain("23f682da17db9594ec1d0e16f0f218475478266f4808d37a5f10b0d22b500e40");
  });

  it("authenticates isolated Loom HTTP probes without recording the token", () => {
    const nativeScript = readFileSync(
      resolve(process.cwd(), "scripts", "Invoke-HookNativeCandidateAcceptance.ps1"),
      "utf8",
    );
    const helpers = readFileSync(
      resolve(process.cwd(), "scripts", "native-candidate-acceptance", "summary-process-wait.ps1"),
      "utf8",
    );

    expect(nativeScript).toContain('$script:LoomRequestHeaders = @{ Authorization = "Bearer $loomAuthToken" }');
    expect(nativeScript).toContain("Loom manifest base URL does not match SurfaceBaseUrl");
    expect(nativeScript).toContain("it must never enter the");
    expect(helpers.match(/\$request\.Headers = \$script:LoomRequestHeaders/g)).toHaveLength(2);
  });
});
