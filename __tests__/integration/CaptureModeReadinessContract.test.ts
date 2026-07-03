import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("capture mode readiness", () => {
  it("does not make the full-screen overlay interactive before the frontend capture listener runs", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const captureStart = rustSource.indexOf("fn enter_capture_mode");
    const captureEnd = rustSource.indexOf("fn enter_long_capture_mode", captureStart);
    const captureBlock = rustSource.slice(captureStart, captureEnd);
    const longCaptureStart = rustSource.indexOf("fn enter_long_capture_mode");
    const longCaptureEnd = rustSource.indexOf("#[tauri::command]", longCaptureStart);
    const longCaptureBlock = rustSource.slice(longCaptureStart, longCaptureEnd);

    expect(captureStart).toBeGreaterThan(-1);
    expect(captureEnd).toBeGreaterThan(captureStart);
    expect(longCaptureStart).toBeGreaterThan(-1);
    expect(longCaptureEnd).toBeGreaterThan(longCaptureStart);
    expect(captureBlock).toContain("show_overlay_host_impl(window, true);");
    expect(longCaptureBlock).toContain("show_overlay_host_impl(window, true);");
  });

  it("arms capture input only after the frontend has disabled hit-testing and made the overlay interactive", () => {
    const appSource = readSource("src/app.tsx");
    const beginStart = appSource.indexOf("const beginCaptureSelection =");
    const beginEnd = appSource.indexOf("// Initialization", beginStart);
    const beginBlock = appSource.slice(beginStart, beginEnd);

    const monitorOffIndex = beginBlock.indexOf("await api.setMouseMonitorActive(false);");
    const overlayInteractiveIndex = beginBlock.indexOf("await api.setOverlayClickThrough(false);");
    const captureInputIndex = beginBlock.indexOf("await api.setCaptureInputActive(true);");

    expect(beginStart).toBeGreaterThan(-1);
    expect(beginEnd).toBeGreaterThan(beginStart);
    expect(monitorOffIndex).toBeGreaterThan(-1);
    expect(overlayInteractiveIndex).toBeGreaterThan(monitorOffIndex);
    expect(captureInputIndex).toBeGreaterThan(overlayInteractiveIndex);
  });
});
