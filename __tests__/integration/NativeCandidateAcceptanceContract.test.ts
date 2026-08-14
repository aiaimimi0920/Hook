import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook native candidate acceptance contract", () => {
  it("approves the isolated pending Hook device before the real Surface probe", () => {
    const script = readFileSync(
      resolve(process.cwd(), "scripts", "Invoke-HookNativeCandidateAcceptance.ps1"),
      "utf8",
    );
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
    expect(script).toContain('$cleanupNeedle = "hook_process_exit_cleanup :: reason=tauri_"');
    expect(instantiate).toBeGreaterThanOrEqual(0);
    expect(approval).toBeGreaterThan(instantiate);
    expect(surfaceProbe).toBeGreaterThan(approval);
    expect(script.slice(approval, surfaceProbe)).not.toContain("instantiate-workflow");
  });

  it("defaults to the reviewed R17/R26 pair and validates both expected digests", () => {
    const nativeScript = readFileSync(
      resolve(process.cwd(), "scripts", "Invoke-HookNativeCandidateAcceptance.ps1"),
      "utf8",
    );
    const pairedScript = readFileSync(
      resolve(process.cwd(), "scripts", "Invoke-HookLoomSurfaceCandidateAcceptance.ps1"),
      "utf8",
    );
    const hookSha = "b12f107f32924db7498cb20f7a69ca926481f08da996b236e90f50b2a7cb894e";
    const daemonSha = "8157b1086580eaca22b0a1764f367f32c966b956509937a7cebf6b3ec0b07293";

    expect(nativeScript).toContain("20260814-art-protocol-review-r17");
    expect(nativeScript).toContain("[ValidatePattern('^[0-9A-Fa-f]{64}$')]");
    expect(nativeScript).toContain(`[string]$ExpectedSha256 = "${hookSha}"`);
    expect(nativeScript).toContain("if ($actualSha256 -ne $ExpectedSha256.Trim().ToLowerInvariant())");
    expect(pairedScript).toContain("20260814-art-protocol-review-r17");
    expect(pairedScript).toContain("20260814-art-protocol-review-r26");
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
});
