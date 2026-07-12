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

describe("overlay mouse activate no-focus contract", () => {
  it("handles WM_MOUSEACTIVATE with MA_NOACTIVATE on the overlay host window, so clicking an existing sticker does not activate Hook and blank hardware-composited video behind it", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const setupOverlayBlock = sourceBetween(
      rustSource,
      "fn setup_overlay_window",
      "#[derive(Clone)]",
    );

    expect(rustSource).toContain("WM_MOUSEACTIVATE");
    expect(rustSource).toContain("MA_NOACTIVATE");
    expect(rustSource).toContain("GWLP_WNDPROC");
    expect(rustSource).toContain("SetWindowLongPtrW");
    expect(rustSource).toContain("CallWindowProcW");
    expect(rustSource).toContain("overlay_mouse_activate_wndproc");
    expect(rustSource).toContain("install_overlay_mouse_activate_no_activate");
    expect(rustSource).toContain("if message == WM_MOUSEACTIVATE");
    expect(rustSource).toContain("return LRESULT(MA_NOACTIVATE as isize)");
    expect(setupOverlayBlock).toContain("install_overlay_mouse_activate_no_activate(window);");
  });
});
