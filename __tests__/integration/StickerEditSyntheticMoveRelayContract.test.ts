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

describe("sticker edit synthetic move relay contract", () => {
  it("keeps a JS target-relay fallback even when native overlay drag move replay is enabled, so synthetic drag streams can still stay attached to the original sticker tool target", () => {
    const appSource = readSource("src/app.tsx");
    const pointerListenerSource = readSource("src/services/appPointerListeners.ts");
    const canvasInteractionSource = readSource("src/services/appCanvasInteractions.ts");
    const rustSource = readHookLibRustSources();
    const dispatchSource = readSource("src/services/overlaySyntheticDispatch.ts");
    const stateSource = readSource("src/services/overlaySyntheticState.ts");
    const globalMoveBlock = sourceBetween(
      canvasInteractionSource,
      "const handleGlobalMouseMove = (event: MouseEvent) => {",
      "const handleGlobalMouseUp = (event: MouseEvent) => {",
    );

    expect(rustSource).toContain("OverlayMove {");
    expect(rustSource).toContain("native_drag_preflight: bool");
    expect(appSource).toContain("registerAppPointerListeners");
    expect(pointerListenerSource).toContain('"overlay/global_mouse_move"');
    expect(stateSource).toContain("moveRelayActive: false");
    expect(dispatchSource).toContain("const relayOverlaySyntheticPointerMove = (event: MouseEvent): void => {");
    expect(dispatchSource).toContain("state.pointerActive");
    expect(dispatchSource).toContain("state.primaryButtonDown");
    expect(dispatchSource).toContain("state.pointerTarget");
    expect(dispatchSource).toContain("new PointerEvent");
    expect(dispatchSource).toContain('new MouseEvent("mousemove"');
    expect(dispatchSource).toContain("state.moveRelayActive = true;");
    expect(dispatchSource).toContain("state.moveRelayActive = false;");
    expect(dispatchSource).toContain("textSelectionActive");
    expect(pointerListenerSource).toContain("overlaySynthetic.textSelectionActive");
    expect(pointerListenerSource).toContain("const textSelectionOwnsPointer = overlaySynthetic.textSelectionActive;");
    expect(pointerListenerSource).toContain("if (!textSelectionOwnsPointer)");
    expect(globalMoveBlock).not.toContain("if (overlaySyntheticMoveRelayActive) return;");
    expect(globalMoveBlock).toContain("if (!overlaySynthetic.moveRelayActive && !draggingStickerId()) {");
    expect(globalMoveBlock).toContain("overlaySynthetic.relayPointerMove(event);");
    expect(globalMoveBlock).toContain("handleDragMove(event);");
  });

  it("skips per-frame top-strip backend rect sync while the edited sticker itself is being whole-dragged, so Ctrl+E mode does not add toolbar-follow lag that normal sticker drag does not have", () => {
    const topStripSource = readSource("src/components/StickerTopStrip.tsx");
    const topStripSyncSource = readSource("src/services/stickerTopStripSync.ts");
    const syncEffectBlock = sourceBetween(
      topStripSource,
      "createEffect(() => {\n        if (typeof window === \"undefined\" || !stripRef) return;\n\n        layout();",
      "onCleanup(() => {",
    );

    expect(topStripSource).toContain("draggingStickerId");
    expect(topStripSource).toContain("const draggingThisSticker = createMemo(() => draggingStickerId() === props.unitId);");
    expect(syncEffectBlock).toContain("if (draggingThisSticker()) return;");
    expect(syncEffectBlock).toContain("addOrUpdateRect(buildStickerTopStripInteractiveRect(stripRef, currentUnitId));");
    expect(syncEffectBlock).toContain("syncTopStripBackendRects();");
    expect(topStripSyncSource).toContain("syncService.updateBackendRects()");
    expect(topStripSyncSource).toContain("void promise.catch");
  });
});
