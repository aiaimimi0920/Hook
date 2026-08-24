import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
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
    const rustSource = readHookLibRustSources();

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
    const dispatchSource = readSource("src/services/overlaySyntheticDispatch.ts");
    const hoverSource = readSource("src/services/overlaySyntheticHover.ts");
    const dispatchBlock = sourceBetween(
      dispatchSource,
      "const dispatchSyntheticOverlayMouseEvent = (",
      "const relayOverlaySyntheticPointerMove = (event: MouseEvent): void => {",
    );

    expect(moveBlock).toContain("|| overlay_drag_active");
    expect(moveBlock).toContain("|| native_drag_preflight_active");
    expect(moveBlock).toContain("CaptureMouseHookEvent::OverlayMove");
    expect(hookProcBlock).toContain("let native_drag_preflight_active =");
    expect(moveBlock).toContain("native_drag_preflight_active");
    expect(moveBlock).not.toContain("return LRESULT(1);");

    expect(refreshBlock).toContain("should_overlay_window_ignore_cursor_events");
    expect(refreshBlock).toContain("set_overlay_click_through_impl(window, should_ignore);");
    expect(rustSource).toContain("OVERLAY_CLICK_THROUGH_ACTIVE.store(click_through, Ordering::SeqCst);");
    expect(rdevMouseMoveBlock).toContain("window.set_ignore_cursor_events(should_ignore)");

    expect(hoverSource).toContain("\"mouseenter\"");
    expect(hoverSource).toContain("\"mouseleave\"");
    expect(dispatchBlock).toContain("\"click\"");
    expect(dispatchBlock).toContain("\"contextmenu\"");
  });
});
