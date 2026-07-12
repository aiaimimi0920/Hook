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

describe("capture input shield contract", () => {
  it("uses a Hook-owned Windows low-level mouse hook for capture input instead of relying on rdev mouse grab", () => {
    const cargoToml = readSource("src-tauri/Cargo.toml");
    const rustSource = readSource("src-tauri/src/lib.rs");

    expect(cargoToml).toContain('rdev = "0.5.3"');
    expect(rustSource).toContain("install_capture_mouse_hook_thread");
    expect(rustSource).toContain("SetWindowsHookExW(WH_MOUSE_LL");
    expect(rustSource).toContain("capture_mouse_hook_proc");
    expect(rustSource).toContain("LRESULT(1)");
    expect(rustSource).not.toContain("rdev::grab(move |event|");
  });

  it("keeps physical cursor movement alive during capture while still consuming buttons and wheels", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const hookProcBlock = sourceBetween(
      rustSource,
      "unsafe extern \"system\" fn capture_mouse_hook_proc",
      "fn install_capture_mouse_hook_thread",
    );
    const moveBlock = sourceBetween(
      hookProcBlock,
      "WM_MOUSEMOVE => {",
      "WM_LBUTTONDOWN =>",
    );
    const captureMoveBranch = sourceBetween(
      moveBlock,
      "if capture_active {",
      "}",
    );
    const downBlock = sourceBetween(
      hookProcBlock,
      "WM_LBUTTONDOWN => {",
      "WM_LBUTTONUP =>",
    );
    const wheelBlock = sourceBetween(
      hookProcBlock,
      "WM_MOUSEWHEEL => {",
      "WM_RBUTTONDOWN",
    );

    expect(hookProcBlock).toContain("WM_MOUSEMOVE");
    expect(hookProcBlock).toContain("WM_LBUTTONDOWN");
    expect(hookProcBlock).toContain("WM_LBUTTONUP");
    expect(hookProcBlock).toContain("WM_MOUSEWHEEL");
    expect(hookProcBlock).not.toContain("SetCursorPos");
    expect(captureMoveBranch).toContain("CaptureMouseHookEvent::Move");
    expect(captureMoveBranch).not.toContain("return LRESULT(1)");
    expect(moveBlock).toContain("CaptureMouseHookEvent::OverlayMove");
    expect(moveBlock).not.toContain("return LRESULT(1)");
    expect(hookProcBlock).toContain("unsafe { CallNextHookEx(None, code, wparam, lparam) }");
    expect(hookProcBlock).toContain("CaptureMouseHookEvent::Down");
    expect(hookProcBlock).toContain("CaptureMouseHookEvent::Up");
    expect(downBlock).toContain("return LRESULT(1)");
    expect(wheelBlock).toContain("return LRESULT(1)");
  });

  it("keeps the overlay click-through during capture because the native hook owns the pointer stream", () => {
    const appSource = readSource("src/app.tsx");
    const beginStart = appSource.indexOf("const beginCaptureSelection =");
    const beginEnd = appSource.indexOf("// Initialization", beginStart);
    const beginBlock = appSource.slice(beginStart, beginEnd);

    const monitorOffIndex = beginBlock.indexOf("await api.setMouseMonitorActive(false);");
    const captureInputIndex = beginBlock.indexOf("await api.setCaptureInputActive(true);");
    const overlayClickThroughIndex = beginBlock.indexOf("await api.setOverlayClickThrough(true);");

    expect(beginStart).toBeGreaterThan(-1);
    expect(beginEnd).toBeGreaterThan(beginStart);
    expect(monitorOffIndex).toBeGreaterThan(-1);
    expect(captureInputIndex).toBeGreaterThan(monitorOffIndex);
    expect(overlayClickThroughIndex).toBeGreaterThan(captureInputIndex);
  });

  it("updates capture mouse position from backend global events and uses a native cursor instead of an in-overlay crosshair", () => {
    const appSource = readSource("src/app.tsx");
    const rustSource = readSource("src-tauri/src/lib.rs");
    const cssSource = readSource("src/app.css");
    const canvasSelectionSource = readSource("src/components/CanvasSelection.tsx");

    expect(appSource).toContain("setMousePos({ x: captureEvent.clientX, y: captureEvent.clientY });");
    expect(appSource).toContain("await api.getCursorPosition()");
    expect(rustSource).toContain("set_capture_cursor_crosshair()");
    expect(rustSource).toContain("SetSystemCursor");
    expect(rustSource).toContain("SystemParametersInfoW(SPI_SETCURSORS");
    expect(canvasSelectionSource).not.toContain("hook-capture-crosshair");
    expect(canvasSelectionSource).not.toContain("截图模式");
    expect(cssSource).not.toContain(".hook-capture-crosshair");
  });

  it("coalesces high-frequency capture mouse move events before emitting them to the webview", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const eventThreadBlock = sourceBetween(
      rustSource,
      '.name("hook-capture-mouse-events".to_string())',
      '.name("hook-capture-mouse-hook".to_string())',
    );

    expect(eventThreadBlock).toContain("let mut deferred_event");
    expect(eventThreadBlock).toContain("receiver.try_recv()");
    expect(eventThreadBlock).toContain("CaptureMouseHookEvent::Move");
    expect(eventThreadBlock).toContain("deferred_event = Some(other_event)");
    expect(eventThreadBlock).toContain('emit_capture_mouse_event(&emit_window, "capture/global_mouse_move", x, y)');
  });

  it("keeps the overlay no-activate so clicking stickers does not steal focus from video surfaces", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const setupOverlayBlock = sourceBetween(
      rustSource,
      "fn setup_overlay_window",
      "#[derive(Clone)]",
    );
    const showCanvasBlock = sourceBetween(
      rustSource,
      "fn show_canvas_window_impl",
      "fn show_overlay_host_impl",
    );
    const clickThroughBlock = sourceBetween(
      rustSource,
      "fn set_overlay_click_through_impl",
      "fn set_overlay_capture_exclusion_impl",
    );
    const refreshBlock = sourceBetween(
      rustSource,
      "fn refresh_overlay_interactivity_for_current_cursor",
      "fn current_cursor_position_physical",
    );
    const rdevMouseMoveBlock = sourceBetween(
      rustSource,
      "rdev::EventType::MouseMove { x, y }",
      "_ => {}",
    );
    const showIndex = setupOverlayBlock.indexOf("window.show()");
    const lastNoActivateIndex = setupOverlayBlock.lastIndexOf("apply_overlay_no_activate(window);");

    expect(rustSource).toContain("WS_EX_NOACTIVATE");
    expect(rustSource).toContain("apply_overlay_no_activate(window);");
    expect(setupOverlayBlock).toContain("apply_overlay_no_activate(window);");
    expect(showIndex).toBeGreaterThan(-1);
    expect(lastNoActivateIndex).toBeGreaterThan(showIndex);
    expect(clickThroughBlock).toContain("apply_overlay_no_activate(window);");
    expect(refreshBlock).toContain("apply_overlay_no_activate(window);");
    expect(rdevMouseMoveBlock).toContain("apply_overlay_no_activate(&window);");
    expect(showCanvasBlock).toContain("clear_overlay_no_activate(window);");
  });

  it("keeps sticker hover synthetic while the overlay window stays click-through so hover/click do not leak or black out the app underneath", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const appSource = readSource("src/app.tsx");
    const overlayRouteBlock = sourceBetween(
      rustSource,
      "fn should_route_overlay_mouse_events",
      "unsafe extern \"system\" fn capture_mouse_hook_proc",
    );
    const hookProcBlock = sourceBetween(
      rustSource,
      "unsafe extern \"system\" fn capture_mouse_hook_proc",
      "fn install_capture_mouse_hook_thread",
    );
    const moveBlock = sourceBetween(
      hookProcBlock,
      "WM_MOUSEMOVE => {",
      "WM_LBUTTONDOWN =>",
    );
    const refreshBlock = sourceBetween(
      rustSource,
      "fn refresh_overlay_interactivity_for_current_cursor",
      "fn current_cursor_position_physical",
    );
    const rdevMouseMoveBlock = sourceBetween(
      rustSource,
      "rdev::EventType::MouseMove { x, y }",
      "_ => {}",
    );

    expect(rustSource).toContain("OverlayDown { x: f64, y: f64 }");
    expect(rustSource).toContain("OverlayMove { x: f64, y: f64 }");
    expect(rustSource).toContain("OverlayUp { x: f64, y: f64 }");
    expect(rustSource).toContain("OverlayContextMenu { x: f64, y: f64 }");
    expect(rustSource).toContain("OVERLAY_MOUSE_HOOK_DRAG_ACTIVE");
    expect(rustSource).toContain("OVERLAY_MOUSE_HOOK_HOVER_ACTIVE");
    expect(rustSource).toContain("OVERLAY_MOUSE_HIT_MAP");
    expect(rustSource).toContain("fn should_route_overlay_mouse_events");
    expect(overlayRouteBlock).toContain(".any(|rect| rect.contains(x, y))");
    expect(overlayRouteBlock).not.toContain('rect.name == "MINI" || rect.name == "FULL"');
    expect(rustSource).toContain("queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown");
    expect(rustSource).toContain("queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayMove");
    expect(rustSource).toContain("queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayUp");
    expect(rustSource).toContain('emit_capture_mouse_event(&emit_window, "overlay/global_mouse_down"');
    expect(rustSource).toContain('emit_capture_mouse_event(&emit_window, "overlay/global_mouse_move"');
    expect(rustSource).toContain('emit_capture_mouse_event(&emit_window, "overlay/global_mouse_up"');
    expect(rustSource).toContain('emit_capture_mouse_event(&emit_window, "overlay/global_context_menu"');
    expect(moveBlock).toContain("if !capture_active && should_route_overlay_mouse {");
    expect(moveBlock).toContain("CaptureMouseHookEvent::OverlayMove");
    expect(moveBlock).toContain("OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);");
    expect(refreshBlock).not.toContain("should_ignore_cursor_events(&rects, cursor_x, cursor_y)");
    expect(refreshBlock).toContain("window.set_ignore_cursor_events(true)");
    expect(refreshBlock).toContain("OVERLAY_CLICK_THROUGH_ACTIVE.store(true, Ordering::SeqCst);");
    expect(rdevMouseMoveBlock).not.toContain("should_route_overlay_mouse_events(x, y)");
    expect(rdevMouseMoveBlock).not.toContain("should_route_overlay_mouse ||");
    expect(rdevMouseMoveBlock).toContain("window.set_ignore_cursor_events(true)");

    expect(appSource).toContain("const dispatchSyntheticOverlayMouseEvent =");
    expect(appSource).toContain("document.elementFromPoint");
    expect(appSource).toContain("new MouseEvent");
    expect(appSource).toContain('"mouseenter"');
    expect(appSource).toContain('"mouseleave"');
    expect(appSource).toContain('"click"');
    expect(appSource).toContain('"contextmenu"');
    expect(appSource).toContain('"overlay/global_mouse_down"');
    expect(appSource).toContain('"overlay/global_mouse_move"');
    expect(appSource).toContain('"overlay/global_mouse_up"');
    expect(appSource).toContain('"overlay/global_mouse_wheel"');
    expect(appSource).toContain('"overlay/global_context_menu"');
  });

  it("reuses the native shield as a full-screen capture blocker so Ctrl+1 drag-select never hovers the app underneath", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const shieldBlock = sourceBetween(
      rustSource,
      "fn sync_overlay_input_shield_region(",
      "#[cfg(not(target_os = \"windows\"))]\nfn sync_overlay_input_shield_region",
    );
    const captureToggleBlock = sourceBetween(
      rustSource,
      "fn set_capture_input_active(",
      "fn show_canvas_window_impl",
    );

    expect(shieldBlock).toContain("CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst)");
    expect(shieldBlock).toContain("CreateRectRgn(0, 0, width, height)");
    expect(captureToggleBlock).toContain("sync_overlay_input_shield_region");
  });

  it("keeps a synthetic hover-exit handoff so leaving a sticker clears overlay hover state before native mouse input resumes underneath", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const hookProcBlock = sourceBetween(
      rustSource,
      "unsafe extern \"system\" fn capture_mouse_hook_proc",
      "fn install_capture_mouse_hook_thread",
    );
    const moveBlock = sourceBetween(
      hookProcBlock,
      "WM_MOUSEMOVE => {",
      "WM_LBUTTONDOWN => {",
    );
    const refreshBlock = sourceBetween(
      rustSource,
      "fn refresh_overlay_interactivity_for_current_cursor",
      "fn current_cursor_position_physical",
    );
    const rdevMouseMoveBlock = sourceBetween(
      rustSource,
      "rdev::EventType::MouseMove { x, y }",
      "_ => {}",
    );

    expect(rustSource).toContain("static OVERLAY_MOUSE_HOOK_HOVER_ACTIVE: AtomicBool = AtomicBool::new(false);");
    expect(rustSource).toContain("let overlay_hover_active = OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.load(Ordering::SeqCst);");
    expect(moveBlock).toContain("if !capture_active && overlay_hover_active {");
    expect(moveBlock).toContain("OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(false, Ordering::SeqCst);");
    expect(refreshBlock).toContain("window.set_ignore_cursor_events(true)");
    expect(rdevMouseMoveBlock).toContain("OVERLAY_CLICK_THROUGH_ACTIVE.store(true, Ordering::SeqCst);");
  });
});
