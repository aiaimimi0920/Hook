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
    expect(script).toContain('/v1/devices/$encodedDeviceId/approve');
    expect(script).toContain('[string]$device.approval -ne "pending"');
    expect(script).toContain('[string]$_.approval -eq "approved"');
    expect(script).toContain('$cleanupNeedle = "hook_process_exit_cleanup :: reason=tauri_"');
    expect(instantiate).toBeGreaterThanOrEqual(0);
    expect(approval).toBeGreaterThan(instantiate);
    expect(surfaceProbe).toBeGreaterThan(approval);
    expect(script.slice(approval, surfaceProbe)).not.toContain("instantiate-workflow");
  });
});
