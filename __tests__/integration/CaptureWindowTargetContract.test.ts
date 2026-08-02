import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("capture window target contract", () => {
  it("enumerates only visible external desktop windows in native Z order", () => {
    const rustSource = readSource("src-tauri/src/capture_windows.rs");
    const libSource = readSource("src-tauri/src/lib.rs");

    expect(rustSource).toContain("EnumWindows");
    expect(rustSource).toContain("GetCurrentProcessId");
    expect(rustSource).toContain("process_id == current_process_id");
    expect(rustSource).toContain("DWMWA_CLOAKED");
    expect(rustSource).toContain("DWMWA_EXTENDED_FRAME_BOUNDS");
    expect(rustSource).toContain('"Progman"');
    expect(rustSource).toContain('"WorkerW"');
    expect(rustSource).toContain('"Shell_TrayWnd"');
    expect(rustSource).toContain("WS_EX_TOOLWINDOW");
    expect(rustSource).toContain("WS_EX_NOACTIVATE");
    expect(libSource).toContain("mod capture_windows;");
    expect(libSource).toContain("list_capture_window_targets,");
    expect(libSource).toContain("fn get_capture_cursor_position(");
  });

  it("loads targets before capture input activation and updates hover without requiring a pressed button", () => {
    const appSource = readSource("src/app.tsx");
    const selectionSource = readSource("src/hooks/useSelection.ts");

    const prepareIndex = appSource.indexOf("await prepareCaptureWindowTargets(initialCapturePoint);");
    const captureInputIndex = appSource.indexOf("await api.setCaptureInputActive(true);", prepareIndex);
    expect(prepareIndex).toBeGreaterThan(-1);
    expect(appSource).toContain("api.getCaptureCursorPosition()");
    expect(captureInputIndex).toBeGreaterThan(prepareIndex);
    expect(appSource).toContain("if (!isSelecting()) return;");
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
});
