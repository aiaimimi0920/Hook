import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const launcherSource = readFileSync(resolve(process.cwd(), "start-otter.bat"), "utf8");
const launcherVbsSource = readFileSync(resolve(process.cwd(), "start-otter.vbs"), "utf8");
const buildSource = readFileSync(resolve(process.cwd(), "build-otter-release.bat"), "utf8");

describe("Otter release launcher contract", () => {
    it("defaults to authenticated local discovery without overriding an explicit disable or endpoint", () => {
        const config = readFileSync(resolve(process.cwd(), "launch-config.cmd"), "utf8");
        expect(config).toContain('if not defined OTTER_ENABLE_LOOM_OTTER set "OTTER_ENABLE_LOOM_OTTER=1"');
        expect(config).toContain('if not defined OTTER_ENABLE_LOOM_OTTER if defined HOOK_ENABLE_LOOM_HOOK');
        expect(launcherVbsSource).toContain('Call SetBrandDefaultEnv("OTTER_ENABLE_LOOM_OTTER", "HOOK_ENABLE_LOOM_HOOK", "1")');
        expect(launcherVbsSource).toContain('If HasEnv(key) Then Exit Sub');
        expect(launcherVbsSource).toContain('processEnv.Item(key) = processEnv.Item(legacyKey)');
        expect(config).not.toContain('set "LOOM_HOOK_WS_URL=');
        expect(launcherVbsSource).not.toContain('SetDefaultEnv("LOOM_HOOK_WS_URL"');
    });
    it("delegates release startup to the hidden VBS launcher and still stops any already-running otter.exe first", () => {
        expect(launcherSource).toContain('call "%~dp0launch-config.cmd"');
        expect(launcherSource).toContain('wscript.exe //nologo "%~dp0start-otter.vbs"');
        expect(launcherVbsSource).toContain('taskkill /IM otter.exe /F >nul 2>nul');
        expect(launcherVbsSource).toContain("shell.Run Quote(otterExe), 0, False");
    });

    it("delegates release packaging to the canonical Otter package script instead of maintaining a second manual copy flow", () => {
        expect(buildSource).toContain('package-otter-release.ps1');
        expect(buildSource).not.toContain("npm run tauri build -- --no-bundle");
        expect(buildSource).not.toContain('src-tauri\\target\\release\\otter.exe');
    });

    it("keeps launcher defaults and runtime-log setup in the VBS entrypoint instead of a visible command shell loop", () => {
        expect(launcherVbsSource).toContain('Call SetBrandDefaultEnv("OTTER_STARTUP_MODE", "HOOK_STARTUP_MODE", "silent")');
        expect(launcherVbsSource).toContain('Call SetBrandDefaultEnv("OTTER_INITIAL_UI_MODE", "HOOK_INITIAL_UI_MODE", "overlay")');
        expect(launcherVbsSource).toContain('Call SetBrandDefaultEnv("OTTER_LOG_DIR", "HOOK_LOG_DIR", shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\\Otter\\logs"))');
        expect(launcherVbsSource).toContain("Call EnsureFolder(processEnv.Item(\"OTTER_LOG_DIR\"))");
        expect(launcherSource).not.toContain("HOOK_LOG_START_SIZE");
        expect(launcherVbsSource).not.toContain('SetDefaultEnv("HOOK_CAPTURE_BACKEND", "gdi")');
    });
});
