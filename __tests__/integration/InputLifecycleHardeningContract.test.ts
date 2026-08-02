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

describe("input lifecycle hardening contract", () => {
  it("invalidates stale delayed capture work before it can clean up a newer session", () => {
    const selectionSource = readSource("src/hooks/useSelection.ts");
    const appSource = readSource("src/app.tsx");
    const selectionEndBlock = sourceBetween(
      selectionSource,
      "const handleSelectionEnd = async",
      "return {",
    );

    expect(selectionSource).toContain("let captureSessionGeneration = 0;");
    expect(selectionSource).toContain("let pendingCaptureTimer: number | null = null;");
    expect(selectionSource).toContain("const beginCaptureSessionLifecycle = () => {");
    expect(selectionSource).toContain("const invalidateCaptureSessionLifecycle = () => {");
    expect(selectionEndBlock).toContain("const sessionGeneration = captureSessionGeneration;");
    expect(selectionEndBlock).toContain("if (!isCaptureSessionCurrent(sessionGeneration))");
    expect(selectionEndBlock).toContain("selection-capture-timer-stale");
    expect(selectionEndBlock).toContain("selection-capture-response-stale");
    expect(selectionEndBlock).toContain(
      "if (!isLongCapture && isCaptureSessionCurrent(sessionGeneration))",
    );
    expect(appSource).toContain("beginCaptureSessionLifecycle();");
    expect(appSource).toContain("invalidateCaptureSessionLifecycle();");
  });

  it("uses a bounded ordered mouse queue that coalesces moves while reserving capacity for edges", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const queueImplementation = sourceBetween(
      rustSource,
      "struct CaptureMouseEventQueue {",
      "trait CaptureMouseEventReceiver",
    );
    const queueBlock = sourceBetween(
      rustSource,
      "fn queue_capture_mouse_hook_event",
      "fn handle_emergency_escape_transition",
    );
    const installBlock = sourceBetween(
      rustSource,
      "fn install_capture_mouse_hook_thread",
      '#[cfg(not(target_os = "windows"))]\nfn install_capture_mouse_hook_thread',
    );

    expect(rustSource).toContain(
      "static CAPTURE_MOUSE_EVENT_QUEUE: OnceLock<Arc<CaptureMouseEventQueue>>",
    );
    expect(rustSource).toContain("const CAPTURE_MOUSE_EVENT_QUEUE_CAPACITY: usize = 2048;");
    expect(rustSource).toContain("const CAPTURE_MOUSE_EVENT_EDGE_RESERVE: usize = 64;");
    expect(rustSource).toContain("events: VecDeque<CaptureMouseHookEvent>");
    expect(queueImplementation).toContain("state.events.len() >= self.move_capacity");
    expect(queueImplementation).toContain("position(CaptureMouseHookEvent::is_move_sample)");
    expect(queueImplementation).toContain("state.diagnostics.coalesced_moves += 1;");
    expect(queueImplementation).toContain("state.diagnostics.critical_overflows += 1;");
    expect(queueBlock).toContain("let _ = queue.enqueue(event);");
    expect(queueBlock).not.toContain("sender.send(event)");
    expect(queueBlock).not.toContain("try_send");
    expect(installBlock).toContain("CaptureMouseEventQueue::new(");
    expect(installBlock).toContain("CAPTURE_MOUSE_EVENT_QUEUE.set(Arc::clone(&queue))");
    expect(installBlock).toContain("queue.recv()");
    expect(installBlock).toContain("coalesce_capture_mouse_move_until_emit");
    expect(installBlock).toContain("coalesce_overlay_mouse_move_until_emit");
    expect(rustSource).toContain("queue.as_ref()");
    expect(installBlock).not.toContain("mpsc::channel::<CaptureMouseHookEvent>()");
  });

  it("accepts only paired native capture button edges and never synthesizes release from polling", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const hookBlock = sourceBetween(
      rustSource,
      'unsafe extern "system" fn capture_mouse_hook_proc',
      "fn install_capture_mouse_hook_thread",
    );

    expect(rustSource).toContain(
      "static CAPTURE_MOUSE_HOOK_BUTTON_DOWN: AtomicBool = AtomicBool::new(false);",
    );
    expect(rustSource).toContain("fn claim_capture_button_transition");
    expect(hookBlock).toContain(
      "claim_capture_button_transition(&CAPTURE_MOUSE_HOOK_BUTTON_DOWN, true)",
    );
    expect(hookBlock).toContain(
      "claim_capture_button_transition(&CAPTURE_MOUSE_HOOK_BUTTON_DOWN, false)",
    );
    expect(hookBlock).toContain("capture_mouse_up_ignored_unpaired");
    expect(rustSource).not.toContain("hook-left-button-release-watchdog");
    expect(rustSource).not.toContain("capture_left_button_release_watchdog");
  });

  it("suppresses sub-35ms Up/Down bounce and coalesces move streams without fixed sleeps", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const eventWorker = sourceBetween(
      rustSource,
      'name("hook-capture-mouse-events"',
      'name("hook-capture-mouse-hook"',
    );
    const emitMouseEvent = sourceBetween(
      rustSource,
      "fn emit_capture_mouse_event(",
      "fn current_modifier_snapshot()",
    );

    expect(rustSource).toContain("CAPTURE_MOUSE_UP_BOUNCE_WINDOW");
    expect(rustSource).toContain("wait_for_capture_mouse_up_debounce");
    expect(eventWorker).toContain("capture_mouse_up_down_bounce_suppressed");
    expect(eventWorker).toContain("CAPTURE_MOUSE_MOVE_EMIT_INTERVAL");
    expect(eventWorker).toContain("OVERLAY_MOUSE_MOVE_EMIT_INTERVAL");
    expect(rustSource).toContain("const OVERLAY_MOUSE_MOVE_EMIT_INTERVAL: Duration = Duration::from_millis(8);");
    expect(eventWorker).toContain("coalesce_overlay_mouse_move_until_emit");
    expect(rustSource).not.toContain("fn throttle_mouse_move_emit");
    expect(emitMouseEvent).toContain("DESKTOP_COLOR_PICKER_ACTIVE.load");
    expect(emitMouseEvent).toContain("sample_screen_color_physical");
    expect(emitMouseEvent).not.toContain("capture_window_metrics(window)");
  });

  it("does not enqueue duplicate input-shield moves while the low-level hook owns the pointer session", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const inputShield = sourceBetween(
      rustSource,
      "fn route_overlay_input_shield_mouse_message(",
      'unsafe extern "system" fn overlay_input_shield_wndproc',
    );
    const moveBlock = sourceBetween(inputShield, "WM_MOUSEMOVE => {", "WM_LBUTTONDOWN => {");

    expect(moveBlock).toContain(
      "overlay_pointer_source_owns_session(OverlayPointerSource::LowLevelHook)",
    );
    expect(moveBlock.indexOf("overlay_pointer_source_owns_session")).toBeLessThan(
      moveBlock.indexOf("queue_capture_mouse_hook_event"),
    );
  });

  it("queries foreground ownership only when Alt is actually pressed", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const mouseHook = sourceBetween(
      rustSource,
      'unsafe extern "system" fn capture_mouse_hook_proc',
      "fn install_capture_mouse_hook_thread",
    );
    const keyboardHook = sourceBetween(
      rustSource,
      'unsafe extern "system" fn overlay_keyboard_hook_proc',
      "fn install_overlay_keyboard_hook_thread",
    );
    const inputShield = sourceBetween(
      rustSource,
      "fn route_overlay_input_shield_mouse_message(",
      'unsafe extern "system" fn overlay_input_shield_wndproc',
    );

    for (const block of [mouseHook, inputShield]) {
      expect(block).toContain("if modifiers.alt_pressed");
      expect(block.indexOf("if modifiers.alt_pressed")).toBeLessThan(
        block.indexOf("hook_process_has_foreground_window()"),
      );
    }

    expect(keyboardHook).toContain("let passthrough = key_pressed");
    expect(keyboardHook.indexOf("let passthrough = key_pressed")).toBeLessThan(
      keyboardHook.indexOf("hook_process_has_foreground_window()"),
    );
    const keyboardModifierPath = keyboardHook.slice(
      keyboardHook.indexOf("let modifiers = current_modifier_snapshot();"),
    );
    expect(keyboardModifierPath).toContain("if modifiers.alt_pressed");
    expect(keyboardModifierPath.indexOf("if modifiers.alt_pressed")).toBeLessThan(
      keyboardModifierPath.indexOf("hook_process_has_foreground_window()"),
    );
  });

  it("counts double Escape before every focus, cursor, and native-dialog gate", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const keyboardHook = sourceBetween(
      rustSource,
      'unsafe extern "system" fn overlay_keyboard_hook_proc',
      "fn install_overlay_keyboard_hook_thread",
    );
    const rdevListener = sourceBetween(
      rustSource,
      "if let Err(error) = rdev::listen",
      'append_runtime_log_line(&format!("rdev_listen_failed',
    );

    expect(rustSource).toContain("static ESCAPE_KEY_DOWN: AtomicBool");
    expect(rustSource).toContain("struct EmergencyEscapeTracker");
    expect(rustSource).toContain("emergency_double_escape_exit");
    expect(keyboardHook.indexOf("handle_emergency_escape_transition")).toBeLessThan(
      keyboardHook.indexOf("overlay_keyboard_capture_should_handle_current_cursor"),
    );
    expect(rdevListener.indexOf("handle_emergency_escape_transition")).toBeLessThan(
      rdevListener.indexOf("NATIVE_FILE_DIALOG_ACTIVE.load"),
    );
    expect(rustSource).not.toContain("last_esc:");
  });

  it("restores the system cursor on startup, normal exit, panic, and emergency exit", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const setupBlock = sourceBetween(
      rustSource,
      "let single_instance_guard =",
      "// Initialize Shared State",
    );
    const panicBlock = sourceBetween(
      rustSource,
      "fn install_panic_logger",
      "fn unix_timestamp_millis",
    );

    expect(rustSource).toContain("fn restore_system_cursors_unconditionally()");
    expect(rustSource).toContain("SystemParametersInfoW(SPI_SETCURSORS");
    expect(setupBlock).toContain("restore_system_cursors_unconditionally();");
    expect(panicBlock).toContain('prepare_for_hook_process_exit("panic")');
    expect(rustSource).toContain('prepare_for_hook_process_exit("double_escape")');
    expect(rustSource).toContain('prepare_for_hook_process_exit("tauri_run_returned")');
  });

  it("deduplicates the same bubbling mouse event across root and window handlers", () => {
    const appSource = readSource("src/app.tsx");

    expect(appSource).toContain("const handledGlobalMouseMoveEvents = new WeakSet<Event>();");
    expect(appSource).toContain("const handledGlobalMouseUpEvents = new WeakSet<Event>();");
    expect(appSource).toContain("if (handledGlobalMouseMoveEvents.has(e)) return;");
    expect(appSource).toContain("if (handledGlobalMouseUpEvents.has(e)) return;");
    expect(appSource).toContain("handleDragMove(e);\n      handleDragEnd();");
  });
});
