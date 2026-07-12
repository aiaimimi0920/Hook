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

describe("overlay live drag shield contract", () => {
  it("promotes the native shield to full-screen while an overlay drag is active, so fast sticker drags and edit-tool drags cannot leak hover to the app underneath", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const dragSource = readSource("src/hooks/useDraggable.ts");
    const hookProcBlock = sourceBetween(
      rustSource,
      "unsafe extern \"system\" fn capture_mouse_hook_proc",
      "fn install_capture_mouse_hook_thread",
    );
    const downBlock = sourceBetween(hookProcBlock, "WM_LBUTTONDOWN => {", "WM_LBUTTONUP => {");
    const shieldBlock = sourceBetween(
      rustSource,
      "fn sync_overlay_input_shield_region(",
      "#[cfg(not(target_os = \"windows\"))]\nfn sync_overlay_input_shield_region",
    );
    const dragMoveBlock = sourceBetween(dragSource, "const handleDragMove = (e: MouseEvent) => {", "const handleDragEnd = async () => {");

    expect(downBlock).toContain("OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(true, Ordering::SeqCst);");
    expect(shieldBlock).toContain("OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst)");
    expect(shieldBlock).toContain("CreateRectRgn(0, 0, width, height)");
    expect(dragMoveBlock).not.toContain("syncService.updateBackendRects");
    expect(dragMoveBlock).not.toContain("requestAnimationFrame");
  });
});
