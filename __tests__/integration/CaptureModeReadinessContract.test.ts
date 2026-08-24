import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("capture mode readiness", () => {
  it("does not make the full-screen overlay interactive before the frontend capture listener runs", () => {
    const rustSource = readHookLibRustSources();
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

  it("arms backend capture input before restoring overlay click-through for native-routed selection input", () => {
    const nativeActionSource = readSource("src/services/appNativeActionController.ts");
    const beginStart = nativeActionSource.indexOf("const beginCaptureSelection =");
    const beginEnd = nativeActionSource.indexOf("const handleNativeEscape =", beginStart);
    const beginBlock = nativeActionSource.slice(beginStart, beginEnd);

    const monitorOffIndex = beginBlock.indexOf("await api.setMouseMonitorActive(false);");
    const captureInputIndex = beginBlock.indexOf("await api.setCaptureInputActive(true);");
    const overlayClickThroughIndex = beginBlock.indexOf("await api.setOverlayClickThrough(true);");

    expect(beginStart).toBeGreaterThan(-1);
    expect(beginEnd).toBeGreaterThan(beginStart);
    expect(monitorOffIndex).toBeGreaterThan(-1);
    expect(captureInputIndex).toBeGreaterThan(monitorOffIndex);
    expect(overlayClickThroughIndex).toBeGreaterThan(captureInputIndex);
  });

  it("does not make the overlay interactive as a side effect of disabling sticker hit-test monitoring", () => {
    const rustSource = readHookLibRustSources();
    const monitorStart = rustSource.indexOf("fn set_mouse_monitor_active");
    const monitorEnd = rustSource.indexOf("#[tauri::command]", monitorStart + 1);
    const monitorBlock = rustSource.slice(monitorStart, monitorEnd);

    expect(monitorStart).toBeGreaterThan(-1);
    expect(monitorEnd).toBeGreaterThan(monitorStart);
    expect(monitorBlock).not.toContain("window.set_ignore_cursor_events(false)");
    expect(monitorBlock).toContain("if active");
    expect(monitorBlock).toContain("refresh_overlay_interactivity_for_current_cursor(&window, &state);");
  });
});
