import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";

describe("Hook startup experience contract", () => {
  it("does not shell out to PowerShell during installed font startup loading", () => {
    const libSource = readHookLibRustSources();
    const fontStart = libSource.indexOf('unsafe extern "system" fn collect_installed_font_family_callback');
    const fontEnd = libSource.indexOf("fn set_overlay_no_activate_flag", fontStart);

    expect(fontStart).toBeGreaterThanOrEqual(0);
    expect(fontEnd).toBeGreaterThan(fontStart);

    const fontSource = libSource.slice(fontStart, fontEnd);
    expect(fontSource).toContain("EnumFontFamiliesExW");
    expect(fontSource).not.toContain("powershell.exe");
  });

  it("loads fonts outside the boot critical path", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");

    expect(appSource).not.toContain("const fonts = await api.getInstalledFonts();");
  });

  it("does not re-show overlay or canvas after startup session restore", () => {
    const startupSource = readFileSync(
      resolve(process.cwd(), "src", "services", "appStartupLifecycle.ts"),
      "utf8",
    );
    const restoreIndex = startupSource.indexOf("await syncService.restoreSession(bootProfile || undefined);");
    const autoStartIndex = startupSource.indexOf("if (bootProfile?.autoStartCapture)");

    expect(restoreIndex).toBeGreaterThanOrEqual(0);
    expect(autoStartIndex).toBeGreaterThan(restoreIndex);

    const startupTail = startupSource.slice(restoreIndex, autoStartIndex);
    expect(startupTail).not.toContain("await api.showCanvasWindow();");
    expect(startupTail).not.toContain("await api.showOverlayHost(true);");
  });

  it("keeps startup window visibility owned by Rust setup instead of re-showing during session restore", () => {
    const syncServiceSource = readFileSync(
      resolve(process.cwd(), "src", "services", "syncService.ts"),
      "utf8",
    );

    expect(syncServiceSource).not.toContain("await api.showCanvasWindow();");
    expect(syncServiceSource).not.toContain("await api.showOverlayHost(true);");
  });

  it("reloads art capabilities after session restore when restored art nodes would otherwise boot without their catalog", () => {
    const startupSource = readFileSync(
      resolve(process.cwd(), "src", "services", "appStartupLifecycle.ts"),
      "utf8",
    );
    const restoreIndex = startupSource.indexOf("await syncService.restoreSession(bootProfile || undefined, preloadedSession);");
    const historyIndex = startupSource.indexOf("const rawHistory = await api.loadHistory();");

    expect(restoreIndex).toBeGreaterThanOrEqual(0);
    expect(historyIndex).toBeGreaterThan(restoreIndex);

    const restoreTail = startupSource.slice(restoreIndex, historyIndex);
    expect(restoreTail).toContain("restoredSessionNeedsCapabilityRefresh");
    expect(restoreTail).toContain("await refreshCapabilities();");
  });

  it("preflights persisted session art capabilities before the first restore so restored art nodes do not boot twice on startup", () => {
    const startupSource = readFileSync(
      resolve(process.cwd(), "src", "services", "appStartupLifecycle.ts"),
      "utf8",
    );
    const preflightLoadIndex = startupSource.indexOf("const preloadedSessionData = await api.loadSession();");
    const preflightCheckIndex = startupSource.indexOf("sessionSnapshotNeedsCapabilityRefresh", preflightLoadIndex);
    const restoreIndex = startupSource.indexOf("await syncService.restoreSession(bootProfile || undefined, preloadedSession);");

    expect(preflightLoadIndex).toBeGreaterThanOrEqual(0);
    expect(preflightCheckIndex).toBeGreaterThan(preflightLoadIndex);
    expect(restoreIndex).toBeGreaterThan(preflightCheckIndex);
  });

  it("re-applies the persisted session after restored-art capability refresh so art nodes rebuild from the real catalog", () => {
    const startupSource = readFileSync(
      resolve(process.cwd(), "src", "services", "appStartupLifecycle.ts"),
      "utf8",
    );
    const restoreIndex = startupSource.indexOf("await syncService.restoreSession(bootProfile || undefined, preloadedSession);");
    const historyIndex = startupSource.indexOf("const rawHistory = await api.loadHistory();");

    expect(restoreIndex).toBeGreaterThanOrEqual(0);
    expect(historyIndex).toBeGreaterThan(restoreIndex);

    const restoreTail = startupSource.slice(restoreIndex, historyIndex);
    const firstRestoreCall = "await syncService.restoreSession(bootProfile || undefined, preloadedSession);";
    const secondRestoreCall = "await syncService.restoreSession(bootProfile || undefined);";
    const firstRestore = restoreTail.indexOf(firstRestoreCall);
    const refreshCall = restoreTail.indexOf("await refreshCapabilities();");
    const secondRestore = restoreTail.indexOf(secondRestoreCall, refreshCall);

    expect(refreshCall).toBeGreaterThan(firstRestore);
    expect(secondRestore).toBeGreaterThan(refreshCall);
  });

  it("logs native frontend readiness only after startup restore and listener initialization", () => {
    const startupSource = readFileSync(
      resolve(process.cwd(), "src", "services", "appStartupLifecycle.ts"),
      "utf8",
    );
    const autoStartIndex = startupSource.indexOf("if (bootProfile?.autoStartCapture)");
    const triggerIndex = startupSource.indexOf("await api.triggerCaptureMode();", autoStartIndex);
    const browserPreviewIndex = startupSource.indexOf("if (!dependencies.tauriRuntime)", triggerIndex);
    const browserPreviewReturnIndex = startupSource.indexOf("return;", browserPreviewIndex);
    const initializedMarkerIndex = startupSource.indexOf('"frontend-initialized"');

    expect(autoStartIndex).toBeGreaterThanOrEqual(0);
    expect(triggerIndex).toBeGreaterThan(autoStartIndex);
    expect(browserPreviewIndex).toBeGreaterThan(triggerIndex);
    expect(browserPreviewReturnIndex).toBeGreaterThan(browserPreviewIndex);
    expect(initializedMarkerIndex).toBeGreaterThan(browserPreviewReturnIndex);

    const initializedCall = startupSource.slice(initializedMarkerIndex - 80, initializedMarkerIndex + 240);
    expect(initializedCall).toContain("await api.debugLogEvent(");
    expect(initializedCall).toContain(
      "capabilities=${graphStore.capabilities.length} units=${graphStore.units.length}",
    );
  });
});
