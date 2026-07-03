import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("capture overlay stability", () => {
  it("keeps regular captures from hiding or excluding the overlay window", () => {
    const selectionPath = path.resolve(process.cwd(), "src/hooks/useSelection.ts");
    const appPath = path.resolve(process.cwd(), "src/app.tsx");
    const uiStorePath = path.resolve(process.cwd(), "src/store/uiStore.ts");
    const apiPath = path.resolve(process.cwd(), "src/services/api.ts");
    const libRsPath = path.resolve(process.cwd(), "src-tauri/src/lib.rs");

    const selectionSource = fs.readFileSync(selectionPath, "utf8");
    const appSource = fs.readFileSync(appPath, "utf8");
    const uiStoreSource = fs.readFileSync(uiStorePath, "utf8");
    const apiSource = fs.readFileSync(apiPath, "utf8");
    const libRsSource = fs.readFileSync(libRsPath, "utf8");

    expect(selectionSource).not.toContain("await api.hideToTray()");
    expect(selectionSource).not.toContain("setIsCaptureSnapshotting(");
    expect(selectionSource).toContain("api.setOverlayClickThrough(true)");

    expect(uiStoreSource).not.toContain("isCaptureSnapshotting");
    expect(appSource).not.toContain("!isCaptureSnapshotting()");
    expect(apiSource).toContain("setOverlayClickThrough");
    expect(selectionSource).not.toContain("setIsCaptureSnapshotting(");
    expect(selectionSource).not.toContain("setOverlayCaptureExclusion(true);\n                const response = await api.captureRegion");
    expect(libRsSource).toContain("set_content_protected(false)");
  });
});
