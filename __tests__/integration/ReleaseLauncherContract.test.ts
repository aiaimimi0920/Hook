import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const launcherSource = readFileSync(resolve(process.cwd(), "start-hook.bat"), "utf8");
const buildSource = readFileSync(resolve(process.cwd(), "build-hook-release.bat"), "utf8");

describe("Hook release launcher contract", () => {
    it("stops any already-running hook.exe before starting the new release so desktop testing cannot silently stay on an older instance", () => {
        expect(launcherSource).toContain('call "%~dp0stop-hook.bat"');
        expect(launcherSource).toContain("Attempting to stop the existing instance before launching this build.");
        expect(launcherSource).toContain("Existing Hook instance is still running after stop request.");
    });

    it("delegates release packaging to the canonical Hook package script instead of maintaining a second manual copy flow", () => {
        expect(buildSource).toContain('package-hook-release.ps1');
        expect(buildSource).not.toContain("npm run tauri build -- --no-bundle");
        expect(buildSource).not.toContain('src-tauri\\target\\release\\hook.exe');
    });

    it("checks frontend readiness only against log lines appended after the current launch starts", () => {
        expect(launcherSource).toContain("HOOK_LOG_START_SIZE");
        expect(launcherSource).toContain("TryParse($env:HOOK_LOG_START_SIZE");
        expect(launcherSource).toContain("[void]$stream.Seek($startSize, [System.IO.SeekOrigin]::Begin)");
        expect(launcherSource).toContain("frontend-mounted");
        expect(launcherSource).toContain("boot-profile-loaded");
    });
});
