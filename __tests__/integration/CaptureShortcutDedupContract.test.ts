import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("capture shortcut de-duplication", () => {
  it("keeps rdev as the fallback for Loom-managed global shortcuts", () => {
    const rustSource = readHookLibRustSources();

    expect(rustSource).toContain("fn configured_global_shortcut_is_registered(");
    expect(rustSource).toContain("fn refresh_configured_global_shortcuts(");
    expect(rustSource).toContain("shortcut_config::global_action(vk_code, modifiers)");
    expect(rustSource).toContain("if !handled_by_registered_shortcut {");
    expect(rustSource).toContain('"rdev_configured_shortcut_triggered :: {action}"');
  });

  it("reserves Ctrl+2 for OCR even when Loom settings contain a conflicting global action", () => {
    const rustSource = readHookLibRustSources();

    expect(rustSource).toContain("fn is_reserved_ocr_binding(");
    expect(rustSource).toContain("if is_reserved_ocr_binding(vk_code, modifiers)");
    expect(rustSource).toContain("if is_reserved_ocr_shortcut(shortcut)");
    expect(rustSource).toContain("filter(|shortcut| !is_reserved_ocr_shortcut(shortcut))");
  });

  it("debounces repeated Tauri Ctrl+1/Ctrl+3 pressed events instead of re-entering capture mode", () => {
    const rustSource = readHookLibRustSources();

    expect(rustSource).toContain("tauri_ctrl_1_last_trigger");
    expect(rustSource).toContain("tauri_ctrl_3_last_trigger");
    expect(rustSource).toContain("tauri_capture_duplicate_ignored");
    expect(rustSource).toContain("tauri_long_capture_duplicate_ignored");
    expect(rustSource).toContain("Duration::from_millis(500)");
  });

  it("refuses to reconfigure the overlay when a native capture session is already active", () => {
    const rustSource = readHookLibRustSources();

    expect(rustSource).toContain("fn try_begin_capture_input_runtime() -> bool");
    expect(rustSource).toContain("CAPTURE_MOUSE_HOOK_ACTIVE.swap(true, Ordering::SeqCst)");
    expect(rustSource).toContain("enter_capture_mode_ignored_active");
    expect(rustSource).toContain("enter_long_capture_mode_ignored_active");
  });

  it("ignores duplicate frontend capture trigger events while a capture session is already active", () => {
    const nativeActionSource = readSource("src/services/appNativeActionController.ts");
    const captureStateSource = readSource("src/services/captureState.ts");

    expect(nativeActionSource).toContain("const beginCaptureSelection =");
    expect(nativeActionSource).toContain("beginCaptureSelectionState(mode, isSelecting())");
    expect(nativeActionSource).toContain("api.debugLogEvent(captureStart.duplicateDebugEvent)");
    expect(captureStateSource).toContain('"trigger-capture-ignored-duplicate"');
    expect(captureStateSource).toContain('"trigger-long-capture-ignored-duplicate"');
  });
});
