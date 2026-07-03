import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook startup experience contract", () => {
  it("does not shell out to PowerShell during installed font startup loading", () => {
    const libSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8");

    expect(libSource).not.toContain('Command::new("powershell.exe")');
  });

  it("loads fonts outside the boot critical path", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");

    expect(appSource).not.toContain("const fonts = await api.getInstalledFonts();");
  });

  it("does not re-show overlay or canvas after startup session restore", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");
    const restoreIndex = appSource.indexOf("await syncService.restoreSession(bootProfile || undefined);");
    const autoStartIndex = appSource.indexOf("if (bootProfile?.autoStartCapture)");

    expect(restoreIndex).toBeGreaterThanOrEqual(0);
    expect(autoStartIndex).toBeGreaterThan(restoreIndex);

    const startupTail = appSource.slice(restoreIndex, autoStartIndex);
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
});
