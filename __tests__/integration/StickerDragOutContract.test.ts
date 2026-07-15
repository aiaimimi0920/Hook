import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(
  resolve(process.cwd(), "src/components/UnitView.tsx"),
  "utf8",
);
const apiSource = readFileSync(
  resolve(process.cwd(), "src/services/api.ts"),
  "utf8",
);
const appSource = readFileSync(
  resolve(process.cwd(), "src/app.tsx"),
  "utf8",
);
const captureRustSource = readFileSync(
  resolve(process.cwd(), "src-tauri/src/capture.rs"),
  "utf8",
);
const clipboardSource = readFileSync(
  resolve(process.cwd(), "src/hooks/useClipboard.ts"),
  "utf8",
);
const useFileDropSource = readFileSync(
  resolve(process.cwd(), "src/hooks/useFileDrop.ts"),
  "utf8",
);
const rustSource = readFileSync(
  resolve(process.cwd(), "src-tauri/src/lib.rs"),
  "utf8",
);
const vendoredDragWindowsSourcePath = resolve(
  process.cwd(),
  "src-tauri/crates/drag/src/platform_impl/windows/mod.rs",
);
const vendoredDragWindowsSource = existsSync(vendoredDragWindowsSourcePath)
  ? readFileSync(vendoredDragWindowsSourcePath, "utf8")
  : "";
const tauriConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as {
  app?: {
    windows?: Array<{
      dragDropEnabled?: boolean;
    }>;
  };
};

describe("Hook sticker drag-out contract", () => {
  const extractRustSection = (startMarker: string, endMarker: string) => {
    const start = rustSource.indexOf(startMarker);
    const end = rustSource.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return rustSource.slice(start, end);
  };
  const extractTsSection = (source: string, startMarker: string, endMarker: string) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  };

  it("keeps Shift as the drag-out modifier and still publishes DownloadURL payloads", () => {
    expect(unitViewSource).toContain("if (!e.shiftKey)");
    expect(unitViewSource).toContain('e.dataTransfer!.setData("DownloadURL", dlUrl)');
  });

  it("keeps the browser-only HTML5 drag fallback free of obvious dead debug artifacts", () => {
    expect(unitViewSource.match(/effectAllowed = \"all\"/g)?.length ?? 0).toBe(1);
    expect(unitViewSource).not.toContain('console.log("DragStart initiated. Shift:", e.shiftKey);');
    expect(unitViewSource).not.toContain('console.log("DragStart: Set file-backed DownloadURL", filename, fileUrl);');
    expect(unitViewSource).not.toContain('console.log("DragStart: Set DownloadURL", filename, blobUrl);');
    expect(unitViewSource).not.toContain("const img = new Image();");
    expect(unitViewSource).not.toContain('console.log(`[UnitView] Rendering Image (Fixed Size Mode) - Src Length: ${displaySrc().length}`);');
    expect(unitViewSource).not.toContain('console.log("Native sticker drag started:", path);');
    expect(rustSource).not.toContain('println!(\n        "Started native sticker drag with payload: {}"');
  });

  it("supports file-backed stickers when dragging out to a Windows folder", () => {
    expect(unitViewSource).toContain("const dragOutFilePath = props.unit.data.filePath");
    expect(unitViewSource).toContain('const fileUrl = encodeURI(`file://${normalizedFilePath}`);');
    expect(unitViewSource).toContain('e.dataTransfer!.setData("text/uri-list", fileUrl);');
    expect(unitViewSource).toContain('e.dataTransfer!.setData("text/plain", dragOutFilePath);');
    expect(unitViewSource.indexOf("if (dragOutFilePath)")).toBeLessThan(
      unitViewSource.indexOf('if (src.startsWith("data:"))'),
    );
  });

  it("disables the native webview drag-drop bridge so Windows HTML5 drag-out can work", () => {
    expect(tauriConfig.app?.windows?.[0]?.dragDropEnabled).toBe(false);
  });

  it("keeps image import working through DOM drop instead of tauri://drag-drop interception", () => {
    expect(useFileDropSource).toContain('window.addEventListener("drop", handleDrop)');
    expect(useFileDropSource).toContain('window.addEventListener("dragover", handleDragOver)');
    expect(useFileDropSource).toContain("e.dataTransfer?.files");
    expect(useFileDropSource).not.toContain('listen("tauri://drag-drop"');
  });

  it("uses a Hook-owned Shift drag-export flow instead of starting OLE DoDragDrop from overlay preflight events", () => {
    expect(appSource).toContain('hook:overlay-native-drag-preflight-down');
    expect(unitViewSource).toContain('window.addEventListener("hook:overlay-native-drag-preflight-down", handlePendingNativeDragOverlayDown as EventListener, true)');
    expect(unitViewSource).toContain("beginHookStickerExportDrag");
    expect(unitViewSource).toContain("api.saveStickerDragExportFromPath(");
    expect(unitViewSource).toContain("api.saveStickerDragExport(");
    expect(unitViewSource).not.toContain("void beginNativeStickerDrag();");
    expect(apiSource).toContain("saveStickerDragExportFromPath");
    expect(apiSource).toContain("save_sticker_drag_export_from_path");
    expect(apiSource).toContain("saveStickerDragExport");
    expect(apiSource).toContain("save_sticker_drag_export");
    expect(rustSource).toContain("fn save_sticker_drag_export_from_path(");
    expect(rustSource).toContain("fn save_sticker_drag_export(");
    expect(rustSource).toContain("resolve_drag_export_target_dir(global_x, global_y)");
  });

  it("keeps the legacy native Windows file drag command available, but routes Shift preflight through Hook-owned export", () => {
    expect(apiSource).toContain("beginStickerNativeFileDrag");
    expect(apiSource).toContain("begin_sticker_native_file_drag");
    expect(apiSource).toContain("beginStickerNativeFileDragFromPath");
    expect(apiSource).toContain("begin_sticker_native_file_drag_from_path");

    expect(unitViewSource).not.toContain("api.beginStickerNativeFileDrag(");
    expect(unitViewSource).not.toContain("api.beginStickerNativeFileDragFromPath(");
    expect(apiSource).toContain("setNativeStickerDragPreflight");
    expect(unitViewSource).toContain("api.setNativeStickerDragPreflight(true)");
    expect(unitViewSource).toContain("api.setNativeStickerDragPreflight(false)");
    expect(unitViewSource).toContain("resolveExistingNativeDragFilePath()");
    expect(unitViewSource).toContain("dragOutFilePath");
    expect(unitViewSource).toContain("renderStickerComposite(");
    expect(appSource).toContain('hook:overlay-native-drag-preflight-down');
    expect(appSource).toContain('hook:overlay-native-drag-preflight-move');
    expect(appSource).toContain('hook:overlay-native-drag-preflight-up');
    expect(unitViewSource).toContain('unitContainerRef?.addEventListener("pointerdown", handleNativeStickerPointerDownCapture, true)');
    expect(unitViewSource).toContain('window.addEventListener("hook:overlay-native-drag-preflight-down", handlePendingNativeDragOverlayDown as EventListener, true)');
    expect(unitViewSource).toContain('window.addEventListener("hook:overlay-native-drag-preflight-move", handlePendingNativeDragOverlayMove as EventListener, true)');
    expect(unitViewSource).toContain('window.addEventListener("hook:overlay-native-drag-preflight-up", handlePendingNativeDragOverlayEnd as EventListener, true)');
    expect(unitViewSource).toContain('window.addEventListener("pointermove", handlePendingNativeDragPointerMove, true)');
    expect(unitViewSource).toContain('window.addEventListener("mousemove", handlePendingNativeDragPointerMove, true)');
    expect(unitViewSource).toContain('window.addEventListener("pointerup", handlePendingNativeDragEnd, true)');
    expect(unitViewSource).toContain('window.addEventListener("mouseup", handlePendingNativeDragEnd, true)');
    expect(unitViewSource).toContain('window.addEventListener("pointercancel", handlePendingNativeDragEnd, true)');
    const pointerDownCaptureSection = extractTsSection(
      unitViewSource,
      "const handleNativeStickerPointerDownCapture = (event: PointerEvent) => {",
      "createEffect(() => {",
    );
    const pendingPointerMoveSection = extractTsSection(
      unitViewSource,
      "const handlePendingNativeDragPointerMove = (event: PointerEvent | MouseEvent) => {",
      "const handlePendingNativeDragEnd =",
    );
    const pendingOverlayMoveSection = extractTsSection(
      unitViewSource,
      "const handlePendingNativeDragOverlayMove = (event: Event) => {",
      "const handlePendingNativeDragEnd =",
    );
    expect(pointerDownCaptureSection).not.toContain("void beginNativeStickerDrag();");
    expect(pointerDownCaptureSection).not.toContain("if (resolveExistingNativeDragFilePath())");
    expect(pendingPointerMoveSection).not.toContain("if (!event.shiftKey)");
    expect(pendingOverlayMoveSection).toContain("updateHookStickerExportDragPreview(point.x, point.y);");

    expect(rustSource).toContain("fn begin_sticker_native_file_drag(");
    expect(rustSource).toContain("fn begin_sticker_native_file_drag_from_path(");
    expect(rustSource).toContain("drag::start_drag(");
    expect(rustSource).toContain("drag::DragItem::Files");
    expect(rustSource).toContain("drag::Image::File");
    const nativeDragHelper = extractRustSection(
      "fn start_native_file_drag_on_ui_thread(",
      "#[cfg(target_os = \"windows\")]\n#[tauri::command]\nfn begin_sticker_native_file_drag(",
    );
    expect(nativeDragHelper).not.toContain("set_overlay_click_through_impl(&window, true)");
    expect(nativeDragHelper).toContain("hide_overlay_input_shield_window();");
    expect(nativeDragHelper).toContain("let _ = window.set_ignore_cursor_events(true);");
    expect(nativeDragHelper).toContain("OVERLAY_CLICK_THROUGH_ACTIVE.store(true, Ordering::SeqCst);");
    expect(nativeDragHelper).toContain("set_overlay_transparent_style(&window, true);");
    expect(nativeDragHelper).toContain("NATIVE_FILE_DRAG_ACTIVE.store(true, Ordering::SeqCst);");
    expect(nativeDragHelper).toContain("NATIVE_FILE_DRAG_ACTIVE.store(false, Ordering::SeqCst);");
    expect(nativeDragHelper).toContain("OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(false, Ordering::SeqCst);");
    expect(nativeDragHelper).toContain("OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.store(false, Ordering::SeqCst);");
    expect(nativeDragHelper).not.toContain("window.hide()");
    expect(nativeDragHelper).not.toContain("show_overlay_host_impl(&window, true);");
    expect(nativeDragHelper.indexOf("hide_overlay_input_shield_window();")).toBeLessThan(
      nativeDragHelper.indexOf("drag::start_drag("),
    );
    expect(nativeDragHelper).toContain("refresh_overlay_interactivity_for_current_cursor(&window, &hit_map)");
    expect(nativeDragHelper).toContain("sync_overlay_input_shield_from_runtime_state(&window);");
    const hookProcSection = extractRustSection(
      "unsafe extern \"system\" fn capture_mouse_hook_proc(",
      "fn install_capture_mouse_hook_thread(window: tauri::WebviewWindow)",
    );
    expect(rustSource).toContain("static NATIVE_FILE_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);");
    expect(hookProcSection).toContain("if NATIVE_FILE_DRAG_ACTIVE.load(Ordering::SeqCst) {");
    expect(hookProcSection).toContain("return unsafe { CallNextHookEx(None, code, wparam, lparam) };");
  });

  it("dispatches Windows native drag work back onto the main UI thread when the IPC command originates off-thread, so DoDragDrop does not strand Hook in a half-drag state", () => {
    const nativeDragHelper = extractRustSection(
      "fn start_native_file_drag(",
      "#[cfg(target_os = \"windows\")]\n#[tauri::command]\nfn begin_sticker_native_file_drag(",
    );
    const nativeDragOnUiThreadHelper = extractRustSection(
      "fn start_native_file_drag_on_ui_thread(",
      "#[cfg(target_os = \"windows\")]\n#[tauri::command]\nfn begin_sticker_native_file_drag(",
    );

    expect(rustSource).toContain(
      "static MAIN_UI_THREAD_ID: OnceLock<std::thread::ThreadId> = OnceLock::new();",
    );
    expect(rustSource).toContain("fn is_main_ui_thread() -> bool");
    expect(nativeDragHelper).toContain("if is_main_ui_thread() {");
    expect(nativeDragHelper).toContain(".run_on_main_thread(move || {");
    expect(nativeDragHelper).toContain("drag_completion_sender");
    expect(nativeDragHelper).toContain("drag_completion_receiver");
    expect(nativeDragHelper).toContain(".recv()");
    expect(nativeDragOnUiThreadHelper).toContain("hide_overlay_input_shield_window();");
  });

  it("vendors the Windows drag source so Hook can keep native drag alive from async overlay IPC by checking the physical left-button state directly", () => {
    expect(readFileSync(resolve(process.cwd(), "src-tauri/Cargo.toml"), "utf8")).toContain(
      'drag = { path = "crates/drag" }',
    );
    expect(vendoredDragWindowsSource).toContain("GetAsyncKeyState");
    expect(vendoredDragWindowsSource).toContain("VK_LBUTTON");
    expect(vendoredDragWindowsSource).toContain("left_button_physically_pressed");
    expect(vendoredDragWindowsSource).toContain("(grfkeystate & MK_LBUTTON) != MODIFIERKEYS_FLAGS(0)");
    expect(vendoredDragWindowsSource).toContain("DROP_SOURCE_STARTUP_GRACE_MS");
    expect(vendoredDragWindowsSource).toContain("observed_left_button_down");
    expect(vendoredDragWindowsSource).toContain("started_at: Instant");
    expect(vendoredDragWindowsSource).toContain("self.started_at.elapsed()");
    expect(vendoredDragWindowsSource).toContain("ACTIVE_DRAG_LEFT_BUTTON_HELD");
    expect(vendoredDragWindowsSource).toContain("install_left_button_tracking_hook");
    expect(vendoredDragWindowsSource).toContain("drag_left_button_tracking_hook_proc");
    expect(vendoredDragWindowsSource).toContain("WM_LBUTTONUP");
    expect(vendoredDragWindowsSource).toContain(
      "ACTIVE_DRAG_LEFT_BUTTON_HELD.load(Ordering::SeqCst)\n            && self.started_at.elapsed().as_millis() < DROP_SOURCE_STARTUP_GRACE_MS",
    );
    expect(vendoredDragWindowsSource).not.toContain(
      "else if ACTIVE_DRAG_LEFT_BUTTON_HELD.load(Ordering::SeqCst) {\n            S_OK\n        }",
    );
  });

  it("captures modifier keys at the low-level mouse hook boundary so synthetic Shift drag-out cannot be downgraded into normal sticker dragging by delayed event emission", () => {
    expect(rustSource).toContain("struct ModifierSnapshot");
    expect(rustSource).toContain("fn current_modifier_snapshot() -> ModifierSnapshot");
    expect(rustSource).toContain("let modifiers = current_modifier_snapshot();");
    expect(rustSource).toContain("static OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE: AtomicBool = AtomicBool::new(false);");
    expect(rustSource).toContain("OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE");
    expect(rustSource).toContain("fn set_native_drag_preflight_active(active: bool) -> Result<(), String>");
    expect(rustSource).toContain("OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.store(active, Ordering::SeqCst);");
    expect(rustSource).toContain("let native_drag_preflight_active =");
    expect(rustSource).toContain("CaptureMouseHookEvent::OverlayDown {");
    expect(rustSource).toContain("CaptureMouseHookEvent::OverlayMove {");
    expect(rustSource).toContain("CaptureMouseHookEvent::OverlayUp {");
    expect(rustSource).toContain('\"shiftKey\": modifiers.shift_pressed');
    expect(rustSource).toContain('\"nativeDragPreflight\": native_drag_preflight');
    expect(rustSource).not.toContain("OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE\n                    .store(modifiers.shift_pressed, Ordering::SeqCst);");
    expect(rustSource).not.toContain("fn emit_capture_mouse_event(\n    window: &tauri::WebviewWindow,\n    event_name: &str,\n    global_x: f64,\n    global_y: f64,\n) {\n    let (ctrl_pressed, alt_pressed, shift_pressed) = current_modifier_state();");
  });

  it("tracks Shift key state independently of focused-window keyboard delivery so selected sticker shortcut capture cannot break Shift drag-out", () => {
    const modifierSnapshotSection = extractRustSection(
      "fn current_modifier_snapshot() -> ModifierSnapshot",
      "#[cfg(not(target_os = \"windows\"))]\nfn current_modifier_snapshot() -> ModifierSnapshot",
    );
    const keyboardHookProc = extractRustSection(
      "unsafe extern \"system\" fn overlay_keyboard_hook_proc(",
      "fn install_overlay_keyboard_hook_thread(window: tauri::WebviewWindow)",
    );

    expect(rustSource).toContain("static OVERLAY_SHIFT_KEY_DOWN: AtomicBool = AtomicBool::new(false);");
    expect(rustSource).toContain("fn update_overlay_modifier_key_state(vk_code: u32, pressed: bool)");
    expect(modifierSnapshotSection).toContain("OVERLAY_SHIFT_KEY_DOWN.load(Ordering::SeqCst)");
    expect(keyboardHookProc).toContain("update_overlay_modifier_key_state(vk_code, true);");
    expect(keyboardHookProc).toContain("update_overlay_modifier_key_state(vk_code, false);");
    expect(keyboardHookProc.indexOf("update_overlay_modifier_key_state(vk_code, true);")).toBeLessThan(
      keyboardHookProc.indexOf("if !overlay_keyboard_capture_should_handle_current_cursor()"),
    );
  });

  it("bypasses synthetic drag state before a Shift sticker body press hands off to native drag", () => {
    const hookProcSection = extractRustSection(
      "unsafe extern \"system\" fn capture_mouse_hook_proc(",
      "fn install_capture_mouse_hook_thread(window: tauri::WebviewWindow)",
    );
    const syntheticOverlaySection = extractTsSection(
      appSource,
      "const dispatchSyntheticOverlayMouseEvent = (",
      "const relayOverlaySyntheticPointerMove =",
    );

    expect(rustSource).toContain("fn is_pointer_over_sticker_body_synthetic_rect(x: f64, y: f64) -> bool");
    expect(hookProcSection).toContain("let shift_sticker_native_drag_preflight =");
    expect(hookProcSection).toContain("modifiers.shift_pressed && is_pointer_over_sticker_body_synthetic_rect(x, y)");
    expect(hookProcSection).toContain("OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE");
    expect(hookProcSection).toContain(".store(true, Ordering::SeqCst);");
    expect(hookProcSection).toContain("native_drag_preflight: true");
    expect(syntheticOverlaySection).toContain("const shouldBypassSyntheticPointerCapture =");
    expect(syntheticOverlaySection).toContain("payload.shiftKey");
    expect(syntheticOverlaySection).toContain("data-sticker-interaction-root");
    expect(appSource).toContain("nativeDragPreflight?: boolean;");
    expect(appSource).toContain("if (event.payload?.nativeDragPreflight) {");
    expect(appSource).toContain('new CustomEvent("hook:overlay-native-drag-preflight-down"');
  });

  it("waits for an actual drag threshold before showing Hook's export preview and keeps native preflight global until mouse-up", () => {
    const pointerDownCaptureSection = extractTsSection(
      unitViewSource,
      "const handleNativeStickerPointerDownCapture = (event: PointerEvent) => {",
      "createEffect(() => {",
    );
    const pendingPointerMoveSection = extractTsSection(
      unitViewSource,
      "const handlePendingNativeDragPointerMove = (event: PointerEvent | MouseEvent) => {",
      "const handlePendingNativeDragEnd =",
    );
    const pendingOverlayMoveSection = extractTsSection(
      unitViewSource,
      "const handlePendingNativeDragOverlayMove = (event: Event) => {",
      "const handlePendingNativeDragEnd =",
    );
    const rdevMouseMoveSection = extractRustSection(
      "rdev::EventType::MouseMove { x, y } => {",
      "_ => {}",
    );

    expect(pointerDownCaptureSection).not.toContain("void beginHookStickerExportDrag(");
    expect(pendingPointerMoveSection).toContain("updateHookStickerExportDragPreview(event.clientX, event.clientY);");
    expect(pendingOverlayMoveSection).toContain("updateHookStickerExportDragPreview(point.x, point.y);");
    expect(unitViewSource).toContain("Math.hypot(x - start.x, y - start.y) < 6");
    expect(rustSource).toContain("&& !native_drag_preflight_active");
    expect(rustSource).toContain("should_route_overlay_mouse || native_drag_preflight_active");
    expect(rdevMouseMoveSection).toContain("if NATIVE_FILE_DRAG_ACTIVE.load(Ordering::SeqCst) {");
    expect(rdevMouseMoveSection).toContain("input_state.is_ignoring_events = true;");
    expect(rdevMouseMoveSection).toContain("return;");
  });

  it("preserves pasted sticker drag-out snapshots so duplicated stickers can use the same fast native path", () => {
    expect(clipboardSource).toContain("dragOutFilePath: s.data.dragOutFilePath || s.data.filePath");
    expect(clipboardSource).toContain("dragOutFilePath: path");
    expect(clipboardSource).toContain("filePath: s.data.filePath");
    expect(clipboardSource).toContain("previewSrc: s.data.previewSrc");
    expect(clipboardSource).toContain("dragOutFilePath: clip.dragOutFilePath");
    expect(clipboardSource).toContain("filePath: clip.filePath");
    expect(unitViewSource).toContain("if (!useExistingPath) {");
    expect(unitViewSource).toContain("graphStore.actions.updateUnitData(props.unit.id, {");
  });

  it("stages a disposable drag file and allows Explorer to complete the drop without hiding the original sticker window", () => {
    expect(rustSource).toContain("fn stage_drag_out_file_copy(");
    expect(rustSource).toContain("drag::DragMode::Copy");
    expect(rustSource).toContain("stage_drag_out_file_copy(&file_path)");
    expect(rustSource).toContain("native_drag_stage_created");
    expect(rustSource).toContain("effect=");
    expect(rustSource).toContain("hresult=");
    const beginNativeDragFromBase64Section = extractRustSection(
      "fn begin_sticker_native_file_drag(",
      "#[cfg(target_os = \"windows\")]\n#[tauri::command]\nfn begin_sticker_native_file_drag_from_path(",
    );
    expect(beginNativeDragFromBase64Section).toContain("drop(file);");
    expect(beginNativeDragFromBase64Section).toContain("let staged_drag_file = stage_drag_out_file_copy(&file_path)?;");
    expect(beginNativeDragFromBase64Section).toContain("start_native_file_drag(window, staged_drag_file, hit_map.inner())?;");
    expect(beginNativeDragFromBase64Section).toContain("Ok(file_path.to_string_lossy().to_string())");
    const beginNativeDragFromPathSection = extractRustSection(
      "fn begin_sticker_native_file_drag_from_path(",
      "#[cfg(not(target_os = \"windows\"))]\n#[tauri::command]\nfn begin_sticker_native_file_drag(",
    );
    expect(beginNativeDragFromPathSection).toContain("let staged_drag_file = stage_drag_out_file_copy(&file_path)?;");
    expect(beginNativeDragFromPathSection).toContain("start_native_file_drag(window, staged_drag_file, hit_map.inner())?;");
    expect(beginNativeDragFromPathSection).toContain("Ok(path)");
    const nativeDragHelper = extractRustSection(
      "fn start_native_file_drag_on_ui_thread(",
      "#[cfg(target_os = \"windows\")]\n#[tauri::command]\nfn begin_sticker_native_file_drag(",
    );
    expect(nativeDragHelper).toContain("mode: drag::DragMode::Copy");
    expect(nativeDragHelper).not.toContain("mode: drag::DragMode::CopyOrMove");
  });

  it("keeps the vendored Windows drag crate capable of copy-or-move effects even though Hook currently exports stickers as copy-only drags", () => {
    expect(vendoredDragWindowsSource).toContain("DragMode::CopyOrMove => DROPEFFECT_COPY | DROPEFFECT_MOVE");
    expect(vendoredDragWindowsSource).toContain("performed_effect: Some(out_dropeffect.0)");
    expect(vendoredDragWindowsSource).toContain("platform_status: Some(drop_result.0)");
  });

  it("persists fresh screenshot captures as file-backed stickers so shift-drag can use the fastest native path", () => {
    expect(captureRustSource).toContain("encode_rgb_image_as_file_capture_response");
    const captureRegionSection = captureRustSource.slice(
      captureRustSource.indexOf("pub async fn capture_region("),
      captureRustSource.indexOf("}", captureRustSource.indexOf("pub async fn capture_region(")) + 1,
    );
    expect(captureRegionSection).not.toContain("file_path: None");
  });
});
