import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("capture window target contract", () => {
  it("enumerates only visible external desktop windows in native Z order", () => {
    const rustSource = readSource("src-tauri/src/capture_windows.rs");
    const libSource = readHookLibRustSources();

    expect(rustSource).toContain("EnumWindows");
    expect(rustSource).toContain("GetCurrentProcessId");
    expect(rustSource).toContain("process_id == current_process_id");
    expect(rustSource).toContain("DWMWA_CLOAKED");
    expect(rustSource).toContain("DWMWA_EXTENDED_FRAME_BOUNDS");
    expect(rustSource).toContain('"Progman"');
    expect(rustSource).toContain('"WorkerW"');
    expect(rustSource).toContain('"Shell_TrayWnd"');
    expect(rustSource).toContain('"Tauri Window"');
    expect(rustSource).toContain("WS_EX_TOOLWINDOW");
    expect(rustSource).toContain("WS_EX_NOACTIVATE");
    expect(libSource).toContain("mod capture_windows;");
    expect(libSource).toContain("list_capture_window_targets,");
    expect(libSource).toContain("fn get_capture_cursor_position(");
  });

  it("loads targets before capture input activation and updates hover without requiring a pressed button", () => {
    const nativeActionSource = readSource("src/services/appNativeActionController.ts");
    const pointerListenerSource = readSource("src/services/appPointerListeners.ts");
    const selectionSource = readSource("src/hooks/useSelection.ts");

    const prepareIndex = nativeActionSource.indexOf("await dependencies.prepareCaptureWindowTargets(initialCapturePoint);");
    const captureInputIndex = nativeActionSource.indexOf("await api.setCaptureInputActive(true);", prepareIndex);
    expect(prepareIndex).toBeGreaterThan(-1);
    expect(nativeActionSource).toContain("api.getCaptureCursorPosition()");
    expect(captureInputIndex).toBeGreaterThan(prepareIndex);
    expect(pointerListenerSource).toContain("if (!isSelecting()) return;");
    expect(selectionSource).toContain("findCaptureWindowTargetAtPoint");
    expect(selectionSource).toContain("updateCaptureWindowHover(e.clientX, e.clientY)");
    expect(selectionSource).toContain("captureWindowTargetLoadGeneration");
  });

  it("requires a same-window double click while preserving ordinary drag selection", () => {
    const selectionSource = readSource("src/hooks/useSelection.ts");
    const stateSource = readSource("src/services/captureState.ts");
    const canvasSource = readSource("src/components/CanvasSelection.tsx");
    const refreshRejectedStart = selectionSource.indexOf("if (!clickedCaptureWindowTarget) {");
    const refreshRejectedEnd = selectionSource.indexOf(
      "confirmedCaptureWindowTargetId =",
      refreshRejectedStart,
    );
    const refreshRejectedBlock = selectionSource.slice(refreshRejectedStart, refreshRejectedEnd);

    expect(selectionSource).toContain("pressedCaptureWindowTarget");
    expect(selectionSource).toContain("refreshCaptureWindowTargetForClick");
    expect(selectionSource).toContain("await api.listCaptureWindowTargets()");
    expect(selectionSource).toContain("capture-window-target-refresh-rejected");
    expect(selectionSource).toContain("capture-window-target-finalized");
    expect(selectionSource).toContain("The selected window is no longer visible on this display");
    expect(refreshRejectedBlock).toContain("setStartPos(null)");
    expect(refreshRejectedBlock).toContain("setSelectionRect(null)");
    expect(stateSource).toContain("findRefreshedCaptureWindowTarget");
    expect(selectionSource).toContain("shouldConfirmCaptureWindowDoubleClick");
    expect(selectionSource).toContain("capture-window-click-armed");
    expect(selectionSource).toContain("capture-window-double-click-confirmed");
    expect(stateSource).toContain("maxIntervalMs = 450");
    expect(canvasSource).toContain("双击截图完整窗口");
    expect(canvasSource).toContain("拖动可自由框选");
  });

  it("uses HWND capture only for confirmed full-window clicks while region drags preserve visible stacking", () => {
    const selectionSource = readSource("src/hooks/useSelection.ts");
    const apiSource = readSource("src/services/apiCapture.ts");
    const typesSource = readSource("src/services/apiTypes.ts");
    const rustSource = readSource("src-tauri/src/capture.rs");
    const captureWindowsSource = readSource("src-tauri/src/capture_windows.rs");
    const dispatchSource = readSource("src-tauri/src/screenshot/dispatch.rs");
    const screenshotSource = readSource("src-tauri/src/screenshot.rs");
    const dwmSharedSurfaceSource = readSource("src-tauri/src/screenshot/dwm_shared_surface.rs");
    const protectedRegionSource = readSource("src-tauri/src/screenshot/protected_region.rs");
    const protectedTargetSource = readSource("src-tauri/src/capture_protected_target.rs");
    const wgcPersistentSource = readSource("src-tauri/src/screenshot/wgc_persistent.rs");
    const wgcTransientSource = readSource("src-tauri/src/screenshot/wgc_transient.rs");
    const wgcSource = readSource("src-tauri/src/screenshot/wgc_session.rs");

    expect(selectionSource).toContain("captureWindowId: captureWindowSurfaceTargetId");
    expect(selectionSource).toContain("captureWindowSurfaceTargetId");
    expect(selectionSource).toContain(
      "captureWindowSurfaceTargetId = clickedCaptureWindowTarget.id;",
    );
    expect(selectionSource).not.toContain(
      "captureWindowSurfaceTargetId = draggedCaptureWindowTarget.id;",
    );
    expect(selectionSource).not.toContain(
      "captureWindowSurfaceTargetId = centerTarget.id;",
    );
    expect(apiSource).toContain("captureWindowId: options?.captureWindowId");
    expect(typesSource).toContain("captureWindowId?: string");
    expect(rustSource).toContain("capture_window_id: Option<String>");
    expect(rustSource).toContain("capture_window_with_dynamic_range(");
    expect(rustSource).toContain("target_recovered");
    expect(rustSource).toContain("process_id_for_capture_window_id");
    expect(captureWindowsSource).toContain("process_id == current_process_id");
    expect(rustSource).toContain("direct_attempt_failed");
    expect(dispatchSource).toContain("pub fn capture_window_with_dynamic_range(");
    expect(dispatchSource).toContain("try_capture_protected_window");
    expect(dispatchSource).toContain("CaptureBackend::DwmSharedSurface");
    expect(dispatchSource).toContain("overlay_compensated: true");
    expect(screenshotSource).toContain("mod dwm_shared_surface;");
    expect(screenshotSource).toContain("pub use dwm_shared_surface::window_display_affinity;");
    expect(screenshotSource).toContain("DwmSharedSurface");
    expect(screenshotSource).toContain("dwm-shared-surface-sdr");
    expect(screenshotSource).toContain("mod wgc_persistent;");
    expect(screenshotSource).toContain("mod wgc_transient;");
    expect(dwmSharedSurfaceSource).toContain("DwmGetDxSharedSurface");
    expect(dwmSharedSurfaceSource).toContain("GetWindowDisplayAffinity");
    expect(dwmSharedSurfaceSource).toContain("if affinity == 0");
    expect(dwmSharedSurfaceSource).toContain("IsWindowVisible(hwnd)");
    expect(dwmSharedSurfaceSource).toContain("IsIconic(hwnd)");
    expect(dwmSharedSurfaceSource).toContain("DwmGetWindowAttribute");
    expect(dwmSharedSurfaceSource).toContain("DwmFlush()");
    expect(dwmSharedSurfaceSource).toContain("OpenSharedResource::<ID3D11Texture2D>");
    expect(dwmSharedSurfaceSource).toContain("D3D11_USAGE_STAGING");
    expect(dwmSharedSurfaceSource).toContain("capture_window dwm_shared_success");
    expect(protectedRegionSource).toContain("capture_area_with_profile");
    expect(protectedRegionSource).toContain("paste_protected_surface");
    expect(protectedRegionSource).toContain("occlusion_rects_for_targets");
    expect(protectedRegionSource).toContain("higher z-order window");
    expect(protectedRegionSource).toContain("protected_composite_success");
    expect(protectedRegionSource).toContain("requested_canvas_size");
    expect(wgcPersistentSource).toContain("PERSISTENT_CAPTURER");
    expect(wgcPersistentSource).toContain("select_wgc_timeout_fallback_frame");
    expect(wgcTransientSource).toContain("try_hdr_capture_transient");
    expect(wgcTransientSource).toContain("unusable_transient_frame");
    expect(wgcSource).toContain("try_fast_capture_window");
    expect(wgcSource).toContain("CreateForWindow(hwnd)");
    expect(wgcSource).toContain("IsWindowVisible(hwnd)");
    expect(wgcSource).toContain("windows_capture_settings(None)");
    expect(wgcSource).toContain("let image = crop_rgb(&image, &crop);");
    expect(wgcSource).toContain("wgc_frame_wait_timeout(false)");
    expect(wgcSource).toContain("capture_window fast_fail");
    expect(wgcSource).toContain("BringWindowToTop(hwnd)");
    expect(wgcSource).toContain("DwmFlush()");
    expect(rustSource).toContain("capture_window overlay_hidden");
    expect(rustSource).toContain("capture_window overlay_restored");
    expect(rustSource).toContain("hide_overlay_input_shield_window");
    expect(rustSource).toContain("sync_overlay_input_shield_from_runtime_state");
    expect(rustSource).toContain("overlapping_protected_window");
    expect(rustSource).toContain("protected_composition_window_id");
    expect(rustSource).not.toContain("if capture_window_id.is_none() {");
    expect(protectedTargetSource).toContain("resolve_protected_window_from_targets");
    expect(protectedTargetSource).toContain("occluding_windows");
    expect(protectedTargetSource).toContain("z_order");
    expect(rustSource).toContain("capture_region protected_target_resolved");
    expect(rustSource).toContain("capture_region_with_protected_window");
    expect(rustSource).toContain("compose_protected_region");
    expect(rustSource).toContain("OVERLAY_MOUSE_HIT_MAP_ACTIVE.swap(false");
    expect(rustSource).toContain("OVERLAY_MOUSE_HIT_MAP_ACTIVE.store(was_active");
    const overlayHideIndex = rustSource.indexOf("capture_window overlay_hidden");
    const workerStartIndex = rustSource.indexOf("tokio::task::spawn_blocking");
    expect(overlayHideIndex).toBeGreaterThan(-1);
    expect(workerStartIndex).toBeGreaterThan(-1);
    expect(overlayHideIndex).toBeLessThan(workerStartIndex);
    expect(wgcSource).not.toContain("Window::from_id");
  });
});
