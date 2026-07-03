import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("capture shortcut de-duplication", () => {
  it("keeps the rdev capture hotkey as a fallback instead of a second active Ctrl+1/Ctrl+3 source", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");

    expect(rustSource).toContain("ctrl_1_global_registered");
    expect(rustSource).toContain("ctrl_3_global_registered");
    expect(rustSource).toContain(
      "!ctrl_1_global_registered_for_rdev.load(Ordering::Relaxed)",
    );
    expect(rustSource).toContain(
      "!ctrl_3_global_registered_for_rdev.load(Ordering::Relaxed)",
    );
  });

  it("debounces repeated Tauri Ctrl+1/Ctrl+3 pressed events instead of re-entering capture mode", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");

    expect(rustSource).toContain("tauri_ctrl_1_last_trigger");
    expect(rustSource).toContain("tauri_ctrl_3_last_trigger");
    expect(rustSource).toContain("tauri_ctrl1_duplicate_ignored");
    expect(rustSource).toContain("tauri_ctrl3_duplicate_ignored");
    expect(rustSource).toContain("Duration::from_millis(500)");
  });

  it("ignores duplicate frontend capture trigger events while a capture session is already active", () => {
    const appSource = readSource("src/app.tsx");
    const captureStateSource = readSource("src/services/captureState.ts");

    expect(appSource).toContain("const beginCaptureSelection =");
    expect(appSource).toContain("beginCaptureSelectionState(mode, isSelecting())");
    expect(appSource).toContain("api.debugLogEvent(captureStart.duplicateDebugEvent)");
    expect(captureStateSource).toContain('"trigger-capture-ignored-duplicate"');
    expect(captureStateSource).toContain('"trigger-long-capture-ignored-duplicate"');
  });
});
