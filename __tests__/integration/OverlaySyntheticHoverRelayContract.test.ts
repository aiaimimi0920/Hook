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

describe("overlay synthetic hover relay contract", () => {
  it("keeps the overlay click-through during sticker hover/click and relies on synthetic mouse relay instead of flipping the native window interactive", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const appSource = readSource("src/app.tsx");

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
    const dispatchBlock = sourceBetween(
      appSource,
      "const dispatchSyntheticOverlayMouseEvent = (",
      "const relayOverlaySyntheticPointerMove = (event: MouseEvent) => {",
    );

    expect(moveBlock).toContain("if !capture_active && should_route_overlay_mouse {");
    expect(moveBlock).toContain("CaptureMouseHookEvent::OverlayMove");
    expect(moveBlock).not.toContain("return LRESULT(1);");

    expect(refreshBlock).toContain("window.set_ignore_cursor_events(true)");
    expect(refreshBlock).toContain("OVERLAY_CLICK_THROUGH_ACTIVE.store(true, Ordering::SeqCst);");
    expect(refreshBlock).not.toContain("window.set_ignore_cursor_events(should_ignore)");
    expect(rdevMouseMoveBlock).not.toContain("window.set_ignore_cursor_events(should_ignore)");

    expect(dispatchBlock).toContain("\"mouseenter\"");
    expect(dispatchBlock).toContain("\"mouseleave\"");
    expect(dispatchBlock).toContain("\"click\"");
    expect(dispatchBlock).toContain("\"contextmenu\"");
  });
});
