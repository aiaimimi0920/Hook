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
    const captureFastPath = sourceBetween(
      hookProcBlock,
      "// Capture has a dedicated global pointer stream.",
      "let should_route_overlay_mouse =",
    );
    const captureMoveBranch = sourceBetween(
      captureFastPath,
      "WM_MOUSEMOVE => {",
      "WM_LBUTTONDOWN => {",
    );
    const overlayPath = hookProcBlock.slice(hookProcBlock.indexOf("let should_route_overlay_mouse ="));
    const overlayMoveBlock = sourceBetween(
      overlayPath,
      "WM_MOUSEMOVE => {",
      "WM_LBUTTONDOWN => {",
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
    expect(overlayMoveBlock).toContain("CaptureMouseHookEvent::OverlayMove");
    expect(hookProcBlock).toContain("let native_drag_preflight_active =");
    expect(overlayMoveBlock).toContain("native_drag_preflight_active");
    expect(overlayMoveBlock).not.toContain("return LRESULT(1)");
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

  it("ends desktop capture only from the matching native down/up stream", () => {
    const appSource = readSource("src/app.tsx");
    const captureListeners = sourceBetween(
      appSource,
      'const unlistenCaptureDown = await listen<NativeCaptureMousePayload>(',
      'const unlistenOverlayMouseDown = await listen<OverlaySyntheticMousePayload>',
    );
    const globalMouseUp = sourceBetween(
      appSource,
      "const handleGlobalMouseUp = (e: MouseEvent) => {",
      "const handleGlobalMouseDown = (e: MouseEvent) => {",
    );

    expect(appSource).toContain("let nativeCapturePointerActive = false;");
    expect(captureListeners).toContain("if (!isSelecting() || nativeCapturePointerActive) return;");
    expect(captureListeners).toContain("nativeCapturePointerActive = true;");
    expect(captureListeners).toContain("if (!isSelecting() || !nativeCapturePointerActive) return;");
    expect(captureListeners).toContain("nativeCapturePointerActive = false;");
    expect(appSource).toContain("shiftKey: !!payload?.shiftKey");
    expect(appSource).toContain("resolveCaptureCtrlModifier(");
    expect(appSource).toContain("ctrlKey: ctrlModifier.effectiveCtrlKey");
    expect(globalMouseUp).toContain("if (!tauriRuntime || !isSelecting()) {");
    expect(globalMouseUp).toContain("handleSelectionEnd(e);");
  });

  it("updates capture mouse position from backend global events and uses a native cursor instead of an in-overlay crosshair", () => {
    const appSource = readSource("src/app.tsx");
    const rustSource = readSource("src-tauri/src/lib.rs");
    const cssSource = readSource("src/app.css");
    const canvasSelectionSource = readSource("src/components/CanvasSelection.tsx");

    expect(appSource).toContain("setMousePos({ x: captureEvent.clientX, y: captureEvent.clientY });");
    expect(appSource).toContain("await api.getCaptureCursorPosition()");
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
    expect(rustSource).toContain("fn coalesce_capture_mouse_move_until_emit(");
    expect(eventThreadBlock).toContain("coalesce_capture_mouse_move_until_emit(");
    expect(eventThreadBlock).toContain("CaptureMouseHookEvent::Move");
    expect(eventThreadBlock).toContain("deferred_event = next;");
    expect(eventThreadBlock).toContain("emit_capture_mouse_event(");
    expect(eventThreadBlock).toContain('"capture/global_mouse_move"');
    expect(eventThreadBlock).toContain("modifiers");
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
    expect(refreshBlock).toContain("set_overlay_click_through_impl(window, should_ignore);");
    expect(rdevMouseMoveBlock).toContain("apply_overlay_no_activate(&window);");
    expect(showCanvasBlock).toContain("clear_overlay_no_activate(window);");
  });

  it("keeps sticker hover synthetic while the overlay window stays click-through so hover/click do not leak or black out the app underneath", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const appSource = readSource("src/app.tsx");
    // The synthetic overlay mouse-event engine now lives in its own module
    // (extracted from app.tsx); app.tsx retains only the overlay/* listener wiring.
    const overlaySource = readSource("src/services/overlaySyntheticEvents.ts");
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
    const overlayPath = hookProcBlock.slice(hookProcBlock.indexOf("let should_route_overlay_mouse ="));
    const moveBlock = sourceBetween(
      overlayPath,
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

    expect(rustSource).toContain("OverlayDown {");
    expect(rustSource).toContain("OverlayMove {");
    expect(rustSource).toContain("OverlayUp {");
    expect(rustSource).toContain("native_drag_preflight: bool");
    expect(rustSource).toMatch(
      /OverlayContextMenu\s*\{\s*x: f64,\s*y: f64,\s*modifiers: ModifierSnapshot,\s*\}/,
    );
    expect(rustSource).toContain("OVERLAY_MOUSE_HOOK_DRAG_ACTIVE");
    expect(rustSource).toContain("OVERLAY_MOUSE_HOOK_HOVER_ACTIVE");
    expect(rustSource).toContain("OVERLAY_MOUSE_HIT_MAP");
    expect(rustSource).toContain("fn should_route_overlay_mouse_events");
    expect(overlayRouteBlock).toContain("is_synthetic_overlay_rect(rect)");
    expect(rustSource).toContain('rect.name == "MINI" || rect.name == "FULL"');
    expect(rustSource).toContain("queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown");
    expect(rustSource).toContain("queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayMove");
    expect(rustSource).toContain("queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayUp");
    expect(rustSource).toContain("emit_capture_mouse_event(");
    expect(rustSource).toContain('"overlay/global_mouse_down"');
    expect(rustSource).toContain('"overlay/global_mouse_move"');
    expect(rustSource).toContain('"overlay/global_mouse_up"');
    expect(rustSource).toContain('"overlay/global_context_menu"');
    expect(moveBlock).toContain("|| overlay_drag_active");
    expect(moveBlock).toContain("CaptureMouseHookEvent::OverlayMove");
    expect(moveBlock).toContain("OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);");
    expect(refreshBlock).not.toContain("should_ignore_cursor_events(&rects, cursor_x, cursor_y)");
    expect(refreshBlock).toContain("should_overlay_window_ignore_cursor_events");
    expect(refreshBlock).toContain("set_overlay_click_through_impl(window, should_ignore);");
    expect(rustSource).toContain("OVERLAY_CLICK_THROUGH_ACTIVE.store(click_through, Ordering::SeqCst);");
    expect(rdevMouseMoveBlock).not.toContain("should_route_overlay_mouse_events(x, y)");
    expect(rdevMouseMoveBlock).not.toContain("should_route_overlay_mouse ||");
    expect(rdevMouseMoveBlock).toContain("should_overlay_window_ignore_cursor_events");
    expect(rdevMouseMoveBlock).toContain("window.set_ignore_cursor_events(should_ignore)");

    expect(overlaySource).toContain("const dispatchSyntheticOverlayMouseEvent =");
    expect(overlaySource).toContain("doc.elementFromPoint");
    expect(overlaySource).toContain("new MouseEvent");
    expect(overlaySource).toContain('"mouseenter"');
    expect(overlaySource).toContain('"mouseleave"');
    expect(overlaySource).toContain('"click"');
    expect(overlaySource).toContain('"contextmenu"');
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
    const overlayPath = hookProcBlock.slice(hookProcBlock.indexOf("let should_route_overlay_mouse ="));
    const moveBlock = sourceBetween(
      overlayPath,
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
    expect(moveBlock).toContain("if !should_route_overlay_mouse");
    expect(moveBlock).toContain("&& !overlay_drag_active");
    expect(moveBlock).toContain("&& overlay_hover_active");
    expect(moveBlock).toContain("OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(false, Ordering::SeqCst);");
    expect(refreshBlock).toContain("set_overlay_click_through_impl(window, should_ignore);");
    expect(rdevMouseMoveBlock).toContain("OVERLAY_CLICK_THROUGH_ACTIVE");
  });
});
