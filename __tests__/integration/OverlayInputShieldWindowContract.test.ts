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
});
