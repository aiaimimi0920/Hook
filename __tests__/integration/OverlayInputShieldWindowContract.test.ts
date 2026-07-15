import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe("overlay input shield window contract", () => {
  it("uses a native no-activate shield window with a rect-union region to block pointer passthrough under stickers without turning the WebView overlay itself interactive", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const updateRectsBlock = sourceBetween(
      rustSource,
      "fn update_pin_rects(",
      "#[tauri::command]\nfn set_mouse_monitor_active",
    );
    const mouseMonitorBlock = sourceBetween(
      rustSource,
      "fn set_mouse_monitor_active(",
      "#[tauri::command]\nfn get_cursor_position",
    );

    expect(rustSource).toContain("ensure_overlay_input_shield_window");
    expect(rustSource).toContain("sync_overlay_input_shield_region");
    expect(rustSource).toContain("CreateWindowExW");
    expect(rustSource).toContain("SetWindowRgn");
    expect(rustSource).toContain("CreateRectRgn");
    expect(rustSource).toContain("CombineRgn");
    expect(rustSource).toContain("SetLayeredWindowAttributes");
    expect(rustSource).toContain("WS_EX_LAYERED");
    expect(rustSource).toContain("MA_NOACTIVATE");
    expect(rustSource).toContain("OVERLAY_INPUT_SHIELD_HWND");
    expect(updateRectsBlock).toContain("sync_overlay_input_shield_region");
    expect(mouseMonitorBlock).toContain("sync_overlay_input_shield_region");
  });

  it("classifies sticker chrome, panels, menus, and ports as synthetic video-safe rects", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");

    expect(rustSource).toContain("fn is_sticker_body_synthetic_rect");
    expect(rustSource).toContain("fn is_overlay_ui_synthetic_rect");
    expect(rustSource).toContain('rect.name == "MINI" || rect.name == "FULL"');
    expect(rustSource).toContain('"STICKER_TOP_STRIP"');
    expect(rustSource).toContain('"STICKER_TOP_STRIP_MENU"');
    expect(rustSource).toContain('"STICKER_CONTEXT_MENU_ROOT"');
    expect(rustSource).toContain('"ACTIONS_MENU"');
    expect(rustSource).toContain('"PARAMS_PANEL"');
    expect(rustSource).toContain('"TEXT_EDITOR"');
    expect(rustSource).toContain('"EXEC_SETTINGS"');
    expect(rustSource).toContain('"COLOR_PICKER"');
    expect(rustSource).toContain('rect.name.starts_with("PORT_IN_")');
    expect(rustSource).toContain('rect.name.starts_with("PORT_OUT_")');
    expect(rustSource).toContain("is_sticker_body_synthetic_rect(rect) || is_overlay_ui_synthetic_rect(rect)");
  });

  it("keeps sticker chrome and popup UI inside the native synthetic shield instead of cutting holes that make the WebView receive real hover", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const shieldBlock = sourceBetween(
      rustSource,
      "fn sync_overlay_input_shield_region(",
      "#[cfg(not(target_os = \"windows\"))]\nfn sync_overlay_input_shield_region",
    );

    expect(shieldBlock).toContain("shield_rects");
    expect(shieldBlock).toContain("is_synthetic_overlay_rect(rect)");
    expect(shieldBlock).not.toContain("cutout_rects");
    expect(shieldBlock).not.toContain("RGN_DIFF");
  });

  it("routes synthetic mouse and wheel events while the cursor is inside overlay UI rects such as font dropdowns and context menus", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const routeBlock = sourceBetween(
      rustSource,
      "fn should_route_overlay_mouse_events(",
      "#[cfg(target_os = \"windows\")]\nunsafe extern \"system\" fn capture_mouse_hook_proc",
    );

    expect(routeBlock).not.toContain("!is_synthetic_overlay_rect(rect) && rect.contains(x, y)");
    expect(routeBlock).toContain("is_synthetic_overlay_rect(rect) && rect.contains(x, y)");
  });

  it("uses the native input shield wndproc as a fallback when Task Manager or another elevated foreground window prevents low-level hook routing", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const createShieldBlock = sourceBetween(
      rustSource,
      "fn ensure_overlay_input_shield_window(",
      "#[cfg(target_os = \"windows\")]\nfn sync_overlay_input_shield_region",
    );
    const shieldRouteBlock = sourceBetween(
      rustSource,
      "fn route_overlay_input_shield_mouse_message(",
      "#[cfg(target_os = \"windows\")]\nunsafe extern \"system\" fn overlay_input_shield_wndproc",
    );
    const shieldWndProcBlock = sourceBetween(
      rustSource,
      "unsafe extern \"system\" fn overlay_input_shield_wndproc(",
      "#[cfg(target_os = \"windows\")]\nfn ensure_overlay_input_shield_window",
    );

    expect(rustSource).toContain("overlay_input_shield_wndproc");
    expect(rustSource).toContain("route_overlay_input_shield_mouse_message");
    expect(rustSource).toContain("OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE");
    expect(createShieldBlock).toContain("overlay_input_shield_wndproc");
    expect(shieldWndProcBlock).toContain("route_overlay_input_shield_mouse_message(message, wparam)");
    expect(shieldRouteBlock).toContain("WM_LBUTTONDOWN");
    expect(shieldRouteBlock).toContain("WM_MOUSEMOVE");
    expect(shieldRouteBlock).toContain("WM_LBUTTONUP");
    expect(shieldRouteBlock).toContain("WM_MOUSEWHEEL");
    expect(shieldRouteBlock).toContain("WM_RBUTTONUP");
    expect(shieldRouteBlock).toContain("CaptureMouseHookEvent::OverlayDown");
    expect(shieldRouteBlock).toContain("CaptureMouseHookEvent::OverlayMove");
    expect(shieldRouteBlock).toContain("CaptureMouseHookEvent::OverlayUp");
    expect(shieldRouteBlock).toContain("CaptureMouseHookEvent::OverlayWheel");
    expect(shieldRouteBlock).toContain("CaptureMouseHookEvent::OverlayContextMenu");
    expect(shieldRouteBlock).toContain("return Some(LRESULT(1));");
  });

  it("keeps the overlay and native input shield at the front of the topmost z-order while stickers are interactive, so Task Manager focus cannot leave stickers unclickable behind it", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const setupBlock = sourceBetween(
      rustSource,
      "fn setup_overlay_window(",
      "#[derive(Clone)]",
    );
    const maintenanceBlock = sourceBetween(
      rustSource,
      "fn install_overlay_topmost_maintenance_thread(",
      "#[cfg(not(target_os = \"windows\"))]\nfn install_overlay_topmost_maintenance_thread",
    );
    const reassertBlock = sourceBetween(
      rustSource,
      "fn reassert_overlay_topmost_window(",
      "#[cfg(target_os = \"windows\")]\nfn install_overlay_topmost_maintenance_thread",
    );

    expect(rustSource).toContain("OVERLAY_TOPMOST_MAINTENANCE_STARTED");
    expect(rustSource).toContain("OVERLAY_MAIN_HWND");
    expect(rustSource).toContain("reassert_overlay_topmost_window");
    expect(setupBlock).toContain("install_overlay_topmost_maintenance_thread");
    expect(maintenanceBlock).toContain("OVERLAY_MOUSE_HIT_MAP_ACTIVE");
    expect(maintenanceBlock).toContain("CAPTURE_MOUSE_HOOK_ACTIVE");
    expect(maintenanceBlock).toContain("overlay_input_shield_hwnd()");
    expect(reassertBlock).toContain("HWND_TOPMOST");
    expect(reassertBlock).toContain("SWP_NOACTIVATE");
    expect(maintenanceBlock).toContain("std::thread::sleep");
  });

  it("retries deferred native hwnd-dependent overlay setup when a uiAccess launch reaches app setup before the WebView exposes its HWND", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const setupBlock = sourceBetween(
      rustSource,
      "fn setup_overlay_window(",
      "#[derive(Clone)]",
    );
    const deferredBlock = sourceBetween(
      rustSource,
      "fn install_overlay_hwnd_retry_thread(",
      "#[cfg(not(target_os = \"windows\"))]\nfn install_overlay_hwnd_retry_thread",
    );
    const resolveHwndBlock = sourceBetween(
      rustSource,
      "fn resolve_overlay_main_hwnd(",
      "#[cfg(target_os = \"windows\")]\nfn hide_overlay_input_shield_window",
    );

    expect(rustSource).toContain("OVERLAY_HWND_RETRY_THREAD_STARTED");
    expect(rustSource).toContain("install_overlay_hwnd_retry_thread");
    expect(rustSource).toContain("resolve_overlay_main_hwnd");
    expect(setupBlock).toContain("install_overlay_hwnd_retry_thread(window);");
    expect(resolveHwndBlock).toContain("window.hwnd()");
    expect(resolveHwndBlock).toContain("EnumWindows");
    expect(rustSource).toContain("GetWindowThreadProcessId");
    expect(deferredBlock).toContain("resolve_overlay_main_hwnd(&window)");
    expect(deferredBlock).toContain("window.app_handle()");
    expect(deferredBlock).toContain('get_webview_window("main")');
    expect(deferredBlock).toContain("apply_overlay_no_activate(&window);");
    expect(deferredBlock).toContain("install_overlay_mouse_activate_no_activate(&window);");
    expect(deferredBlock).toContain("install_overlay_topmost_maintenance_thread(&window);");
    expect(deferredBlock).toContain("std::thread::sleep");
    expect(deferredBlock).toContain("overlay_hwnd_retry_completed");
  });
});
