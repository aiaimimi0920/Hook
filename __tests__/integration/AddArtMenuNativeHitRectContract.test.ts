import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";

const readSource = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe("Add Art native hit rectangle contract", () => {
  it("measures the rendered menu instead of reconstructing its bounds from sticker coordinates", () => {
    const source = readSource("src/components/UnitAddNodeMenu.tsx");
    const syncBlock = sourceBetween(
      source,
      "const syncMenuHitRect = () => {",
      "const scheduleMenuRectSync = () => {",
    );

    expect(syncBlock).toContain("menuRootRef.getBoundingClientRect()");
    expect(syncBlock).toContain('name: "ACTIONS_MENU"');
    expect(syncBlock).toContain("requestBackendRectSync()");
    expect(syncBlock).not.toContain("props.currentPos");
  });

  it("keeps low-level hit testing global while converting shield regions back to window-local coordinates", () => {
    const source = readHookLibRustSources();
    const updateBlock = sourceBetween(source, "fn update_pin_rects(", "#[tauri::command]\nfn set_mouse_monitor_active");
    const shieldBlock = sourceBetween(
      source,
      "fn sync_overlay_input_shield_region(",
      "#[cfg(not(target_os = \"windows\"))]\nfn sync_overlay_input_shield_region",
    );

    expect(updateBlock).toContain('app.get_webview_window("main")');
    expect(updateBlock).toContain("window.inner_position().ok()");
    expect(updateBlock).toContain("mouse_monitor::offset_rects(&rects, origin.x, origin.y)");
    expect(updateBlock).toContain("*overlay_rectangles = global_rects.clone()");
    expect(shieldBlock).toContain("rect.x.saturating_sub(main_rect.left)");
    expect(shieldBlock).toContain("rect.y.saturating_sub(main_rect.top)");
  });

  it("forwards native overlay mouseup through a stable window event before DOM synthesis", () => {
    const pointerListenerSource = readSource("src/services/appPointerListeners.ts");
    const menuSource = readSource("src/components/UnitAddNodeMenu.tsx");
    const mouseUpBlock = sourceBetween(
      pointerListenerSource,
      'listen<OverlaySyntheticMousePayload>(\n        "overlay/global_mouse_up",',
      'listen<OverlaySyntheticMousePayload>(\n        "overlay/global_mouse_wheel",',
    );

    const stableEventIndex = mouseUpBlock.indexOf("OVERLAY_GLOBAL_MOUSE_UP_EVENT");
    const syntheticMouseUpIndex = mouseUpBlock.indexOf('overlaySynthetic.dispatch("mouseup"');
    expect(stableEventIndex).toBeGreaterThanOrEqual(0);
    expect(syntheticMouseUpIndex).toBeGreaterThan(stableEventIndex);
    expect(menuSource).toContain(
      "window.addEventListener(OVERLAY_GLOBAL_MOUSE_UP_EVENT, handleNativeOverlayMouseUp)",
    );
    expect(menuSource).toContain('completePendingArtActivation(clientX, clientY, "native-mouseup")');
  });
});
