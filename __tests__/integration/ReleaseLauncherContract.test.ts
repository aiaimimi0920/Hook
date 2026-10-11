import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const launcherSource = readFileSync(resolve(process.cwd(), "start-hook.bat"), "utf8");
const launcherVbsSource = readFileSync(resolve(process.cwd(), "start-hook.vbs"), "utf8");
const buildSource = readFileSync(resolve(process.cwd(), "build-hook-release.bat"), "utf8");

describe("Hook release launcher contract", () => {
    it("defaults to authenticated local discovery without overriding an explicit disable or endpoint", () => {
        const config = readFileSync(resolve(process.cwd(), "launch-config.cmd"), "utf8");
        expect(config).toContain('if not defined HOOK_ENABLE_LOOM_HOOK set "HOOK_ENABLE_LOOM_HOOK=1"');
        expect(launcherVbsSource).toContain('Call SetDefaultEnv("HOOK_ENABLE_LOOM_HOOK", "1")');
        expect(config).not.toContain('set "LOOM_HOOK_WS_URL=');
        expect(launcherVbsSource).not.toContain('SetDefaultEnv("LOOM_HOOK_WS_URL"');
    });
    it("delegates release startup to the hidden VBS launcher and still stops any already-running hook.exe first", () => {
        expect(launcherSource).toContain('call "%~dp0launch-config.cmd"');
        expect(launcherSource).toContain('wscript.exe //nologo "%~dp0start-hook.vbs"');
        expect(launcherVbsSource).toContain('taskkill /IM hook.exe /F >nul 2>nul');
        expect(launcherVbsSource).toContain("shell.Run Quote(hookExe), 0, False");
    });

    it("delegates release packaging to the canonical Hook package script instead of maintaining a second manual copy flow", () => {
        expect(buildSource).toContain('package-hook-release.ps1');
        expect(buildSource).not.toContain("npm run tauri build -- --no-bundle");
        expect(buildSource).not.toContain('src-tauri\\target\\release\\hook.exe');
    });

    it("keeps launcher defaults and runtime-log setup in the VBS entrypoint instead of a visible command shell loop", () => {
        expect(launcherVbsSource).toContain('Call SetDefaultEnv("HOOK_STARTUP_MODE", "silent")');
        expect(launcherVbsSource).toContain('Call SetDefaultEnv("HOOK_INITIAL_UI_MODE", "overlay")');
        expect(launcherVbsSource).toContain('Call SetDefaultEnv("HOOK_LOG_DIR", shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\\Hook\\logs"))');
        expect(launcherVbsSource).toContain("Call EnsureFolder(processEnv.Item(\"HOOK_LOG_DIR\"))");
        expect(launcherSource).not.toContain("HOOK_LOG_START_SIZE");
        expect(launcherVbsSource).not.toContain('SetDefaultEnv("HOOK_CAPTURE_BACKEND", "gdi")');
    });
});
