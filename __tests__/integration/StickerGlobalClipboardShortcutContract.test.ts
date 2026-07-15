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

describe("sticker global clipboard shortcut contract", () => {
  it("captures Ctrl+C/Ctrl+V from the low-level keyboard hook when the overlay is intentionally unfocused", () => {
    const appSource = readSource("src/app.tsx");
    const rustSource = readSource("src-tauri/src/lib.rs");

    const keyMatcherBlock = sourceBetween(
      rustSource,
      "fn overlay_keyboard_hook_event_for_keydown",
      "unsafe extern \"system\" fn overlay_keyboard_hook_proc",
    );
    const keyboardHookBlock = sourceBetween(
      rustSource,
      "unsafe extern \"system\" fn overlay_keyboard_hook_proc",
      "fn install_overlay_keyboard_hook_thread",
    );
    const keyboardHookThread = sourceBetween(
      rustSource,
      "fn install_overlay_keyboard_hook_thread",
      "#[cfg(not(target_os = \"windows\"))]\nfn install_overlay_keyboard_hook_thread",
    );
    const tauriListenBlock = sourceBetween(
      appSource,
      'const unlistenOpenImage = await listen("trigger-open-image"',
      'const unlistenVoiceHotkey = await listen<VoiceHotkeyPayload>',
    );

    expect(keyMatcherBlock).toContain("VK_KEY_C");
    expect(keyMatcherBlock).toContain("VK_KEY_V");
    expect(keyMatcherBlock).toContain("modifiers.ctrl_pressed");
    expect(keyboardHookBlock).toContain("return LRESULT(1);");
    expect(keyboardHookThread).toContain('"trigger-copy"');
    expect(keyboardHookThread).toContain('"trigger-paste"');
    expect(keyboardHookThread).not.toContain("window.set_focus()");

    expect(tauriListenBlock).toContain('listen("trigger-copy"');
    expect(tauriListenBlock).toContain('listen("trigger-paste"');
    expect(tauriListenBlock).toContain("if (!selectedStickerId()) return;");
    expect(tauriListenBlock).toContain("void handleCopy();");
    expect(tauriListenBlock).toContain("void handlePaste();");
  });

  it("captures Hook-owned sticker shortcuts with a low-level keyboard hook so they do not leak to the app underneath", () => {
    const appSource = readSource("src/app.tsx");
    const apiSource = readSource("src/services/api.ts");
    const rustSource = readSource("src-tauri/src/lib.rs");

    const keyboardHookProc = sourceBetween(
      rustSource,
      "unsafe extern \"system\" fn overlay_keyboard_hook_proc",
      "fn install_overlay_keyboard_hook_thread",
    );
    const keyboardCaptureCursorHelper = sourceBetween(
      rustSource,
      "fn overlay_keyboard_capture_should_handle_current_cursor",
      "unsafe extern \"system\" fn overlay_keyboard_hook_proc",
    );
    const keyMatcherBlock = sourceBetween(
      rustSource,
      "fn overlay_keyboard_hook_event_for_keydown",
      "unsafe extern \"system\" fn overlay_keyboard_hook_proc",
    );
    const keyboardHookThread = sourceBetween(
      rustSource,
      "fn install_overlay_keyboard_hook_thread",
      "#[cfg(not(target_os = \"windows\"))]\nfn install_overlay_keyboard_hook_thread",
    );
    const setupBlock = sourceBetween(
      rustSource,
      "install_capture_mouse_hook_thread(window.clone());",
      "if boot_profile.initial_ui_mode == \"tray\"",
    );
    const appKeyboardCaptureEffect = sourceBetween(
      appSource,
      "createEffect(() => {",
      "// Shortcuts",
    );
    const rdevEscapeDeleteBlock = sourceBetween(
      rustSource,
      "rdev::EventType::KeyPress(rdev::Key::Escape)",
      "rdev::EventType::KeyPress(rdev::Key::Return)",
    );

    expect(rustSource).toContain("static OVERLAY_KEYBOARD_CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);");
    expect(rustSource).toContain("enum OverlayKeyboardHookEvent");
    expect(rustSource).toContain("fn set_overlay_keyboard_capture_active(active: bool) -> Result<(), String>");
    expect(rustSource).toContain("set_overlay_keyboard_capture_active,");

    expect(keyboardHookProc).toContain("KBDLLHOOKSTRUCT");
    expect(keyboardHookProc).toContain("overlay_keyboard_capture_should_handle_current_cursor()");
    expect(keyboardHookProc).toContain("queue_overlay_keyboard_hook_event");
    expect(keyboardHookProc).toContain("return LRESULT(1);");
    expect(keyboardCaptureCursorHelper).toContain("OVERLAY_KEYBOARD_CAPTURE_ACTIVE.load(Ordering::SeqCst)");
    expect(keyboardCaptureCursorHelper).toContain("current_cursor_position_physical()");
    expect(keyboardCaptureCursorHelper).toContain("should_route_overlay_mouse_events(x, y)");
    expect(keyMatcherBlock).toContain("VK_ESCAPE");
    expect(keyMatcherBlock).toContain("VK_DELETE");
    expect(keyMatcherBlock).toContain("VK_BACK");
    expect(keyMatcherBlock).toContain("VK_KEY_C");
    expect(keyMatcherBlock).toContain("VK_KEY_V");
    expect(keyMatcherBlock).toContain("modifiers.ctrl_pressed");

    expect(keyboardHookThread).toContain("SetWindowsHookExW(WH_KEYBOARD_LL");
    expect(keyboardHookThread).toContain("WH_KEYBOARD_LL");
    expect(keyboardHookThread).toContain('"trigger-escape"');
    expect(keyboardHookThread).toContain('"trigger-delete"');
    expect(keyboardHookThread).toContain('"trigger-copy"');
    expect(keyboardHookThread).toContain('"trigger-paste"');
    expect(keyboardHookThread).not.toContain("window.set_focus()");
    expect(setupBlock).toContain("install_overlay_keyboard_hook_thread(window.clone());");

    expect(apiSource).toContain("setOverlayKeyboardCaptureActive");
    expect(apiSource).toContain('"set_overlay_keyboard_capture_active"');
    expect(appKeyboardCaptureEffect).toContain("api.setOverlayKeyboardCaptureActive");
    expect(appKeyboardCaptureEffect).toContain("Boolean(selectedStickerId())");
    expect(appKeyboardCaptureEffect).toContain("!isSelecting()");
    expect(rdevEscapeDeleteBlock).toContain("overlay_keyboard_capture_should_handle_current_cursor()");
  });
});
