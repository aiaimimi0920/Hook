import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";

describe("capture overlay stability", () => {
  it("uses the final mouse-up coordinate before ending a capture so fast drags are not mistaken for zero-size screenshots", () => {
    const selectionPath = path.resolve(process.cwd(), "src/hooks/useSelection.ts");
    const pointerListenerPath = path.resolve(process.cwd(), "src/services/appPointerListeners.ts");

    const selectionSource = fs.readFileSync(selectionPath, "utf8");
    const pointerListenerSource = fs.readFileSync(pointerListenerPath, "utf8");

    expect(selectionSource).toContain('const handleSelectionEnd = async (event?: Pick<MouseEvent, "clientX" | "clientY" | "shiftKey" | "ctrlKey">) => {');
    expect(selectionSource).toContain("if (event && isSelecting() && startPos()) {");
    expect(selectionSource).toContain("handleSelectionMove(event);");

    const captureUpStart = pointerListenerSource.indexOf('"capture/global_mouse_up"');
    expect(captureUpStart).toBeGreaterThanOrEqual(0);
    const captureUpEnd = pointerListenerSource.indexOf('"overlay/global_mouse_down"', captureUpStart);
    expect(captureUpEnd).toBeGreaterThan(captureUpStart);
    const captureUpBlock = pointerListenerSource.slice(captureUpStart, captureUpEnd);
    expect(captureUpBlock).toContain("handleSelectionMove(captureEvent);");
    expect(captureUpBlock).toContain("handleSelectionEnd(captureEvent)");
    expect(captureUpBlock.indexOf("handleSelectionMove(captureEvent);")).toBeLessThan(
      captureUpBlock.indexOf("handleSelectionEnd(captureEvent)"),
    );
  });

  it("never lets an out-of-order precise-selection response replace the live pointer rectangle", () => {
    const preciseSelectionPath = path.resolve(process.cwd(), "src/hooks/preciseSelectionController.ts");
    const preciseSelectionSource = fs.readFileSync(preciseSelectionPath, "utf8");

    expect(preciseSelectionSource).toContain("const PRECISE_SELECTION_DEBOUNCE_MS = 80;");
    expect(preciseSelectionSource).toContain("let preciseRequestGeneration = 0;");
    expect(preciseSelectionSource).toContain("requestGeneration !== preciseRequestGeneration");
    expect(preciseSelectionSource).toContain("!dependencies.isCaptureSessionCurrent(sessionGeneration)");
    expect(preciseSelectionSource).toContain("!captureRectsMatch(selectionRect(), sourceRect)");
    expect(preciseSelectionSource).toContain("captureRectsMatch(preciseRectSource, currentSelectionRect)");
    expect(preciseSelectionSource).toContain("return currentPreciseRect &&");
  });

  it("keeps synchronous screen capture work off the hot IPC path and bounds region capture hangs", () => {
    const capturePath = path.resolve(process.cwd(), "src-tauri/src/capture.rs");
    const captureSource = fs.readFileSync(capturePath, "utf8");

    expect(captureSource).toContain("static REGION_CAPTURE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);");
    expect(captureSource).toContain("const REGION_CAPTURE_TIMEOUT: Duration = Duration::from_secs(6);");
    expect(captureSource).toMatch(/REGION_CAPTURE_IN_FLIGHT\s*\.compare_exchange\(\s*false,\s*true/);
    expect(captureSource).toContain("tokio::task::spawn_blocking(move ||");
    expect(captureSource).toContain("tokio::time::timeout(REGION_CAPTURE_TIMEOUT");
    expect(captureSource).toContain("capture_region timeout");
    expect(captureSource).toContain("REGION_CAPTURE_IN_FLIGHT.store(false, Ordering::SeqCst);");
  });

  it("keeps regular captures from hiding or excluding the overlay window", () => {
    const selectionPath = path.resolve(process.cwd(), "src/hooks/useSelection.ts");
    const appPath = path.resolve(process.cwd(), "src/app.tsx");
    const uiStorePath = path.resolve(process.cwd(), "src/store/uiStore.ts");
    const overlayWindowApiPath = path.resolve(process.cwd(), "src/services/apiOverlayWindow.ts");

    const selectionSource = fs.readFileSync(selectionPath, "utf8");
    const appSource = fs.readFileSync(appPath, "utf8");
    const uiStoreSource = fs.readFileSync(uiStorePath, "utf8");
    const overlayWindowApiSource = fs.readFileSync(overlayWindowApiPath, "utf8");
    const libRsSource = readHookLibRustSources();

    expect(selectionSource).not.toContain("await api.hideToTray()");
    expect(selectionSource).not.toContain("setIsCaptureSnapshotting(");
    expect(selectionSource).toContain("api.setOverlayClickThrough(true)");

    expect(uiStoreSource).not.toContain("isCaptureSnapshotting");
    expect(appSource).not.toContain("!isCaptureSnapshotting()");
    expect(overlayWindowApiSource).toContain("setOverlayClickThrough");
    expect(selectionSource).not.toContain("setIsCaptureSnapshotting(");
    expect(selectionSource).not.toContain("setOverlayCaptureExclusion(true);\n                const response = await api.captureRegion");
    expect(libRsSource).toContain("set_content_protected(false)");
  });
});
