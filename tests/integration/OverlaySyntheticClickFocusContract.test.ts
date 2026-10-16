import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("overlay synthetic click and focus contract", () => {
  const dispatchSource = readSource("src/platform/desktop/overlaySyntheticDispatch.ts");
  const stateSource = readSource("src/platform/desktop/overlaySyntheticState.ts");
  const targetsSource = readSource("src/platform/desktop/overlaySyntheticTargets.ts");
  const typesSource = readSource("src/platform/desktop/overlaySyntheticTypes.ts");

  it("dispatches a synthetic dblclick for overlay-routed sticker clicks so double-click minify still works while the full-screen overlay stays click-through", () => {
    expect(dispatchSource).toContain('"dblclick"');
    expect(dispatchSource).toContain("state.lastClickTarget");
    expect(dispatchSource).toContain("state.lastClickAt");
    expect(typesSource).toContain("OVERLAY_SYNTHETIC_DOUBLE_CLICK_MAX_DELAY_MS");
    expect(stateSource).toContain("lastClickTarget: EventTarget | null;");
  });

  it("focuses overlay-hosted editors through the top-strip property bar and still keeps synthetic editable-control fallback logic for routed clicks", () => {
    const overlayWindowApiSource = readSource("src/platform/tauri/apiOverlayWindow.ts");
    const propertyBarSource = readSource("src/features/stickers/components/StickerTopStripPropertyBar.tsx");

    expect(overlayWindowApiSource).toContain("focusOverlayWindow");
    expect(propertyBarSource).toContain("api.focusOverlayWindow()");
    expect(targetsSource).toContain("HTMLInputElement");
    expect(targetsSource).toContain("HTMLSelectElement");
    expect(targetsSource).toContain("HTMLTextAreaElement");
    expect(targetsSource).toContain(".focus()");
  });

  it("routes overlay drag move events straight to app-main and skips the synthetic relay fallback while a whole-sticker drag is active, so Ctrl+E mode does not add sticky per-move annotation-layer overhead", () => {
    const appSource = readSource("src/app/app.tsx");
    const canvasInteractionsSource = readSource("src/app/appCanvasInteractions.ts");

    expect(appSource).toContain("createAppCanvasInteractions");
    expect(canvasInteractionsSource).toContain("draggingStickerId()");
    // Drag-move target is pinned to #app-main, gated on button-down + dragging.
    expect(dispatchSource).toContain("const pinDragTargetToAppMain =");
    expect(dispatchSource).toContain("&& state.primaryButtonDown");
    expect(dispatchSource).toContain("deps.getDraggingStickerId()");
    expect(dispatchSource).toContain("target = appMain ?? win;");
    expect(canvasInteractionsSource).toContain("if (!overlaySynthetic.moveRelayActive && !draggingStickerId()) {");
  });
});
