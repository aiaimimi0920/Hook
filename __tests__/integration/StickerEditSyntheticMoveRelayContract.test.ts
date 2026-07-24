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

describe("sticker edit synthetic move relay contract", () => {
  it("keeps a JS target-relay fallback even when native overlay drag move replay is enabled, so synthetic drag streams can still stay attached to the original sticker tool target", () => {
    const appSource = readSource("src/app.tsx");
    const rustSource = readSource("src-tauri/src/lib.rs");
    const globalMoveBlock = sourceBetween(
      appSource,
      "const handleGlobalMouseMove = (e: MouseEvent) => {",
      "const handleGlobalMouseUp = (e: MouseEvent) => {",
    );

    expect(rustSource).toContain("OverlayMove {");
    expect(rustSource).toContain("native_drag_preflight: bool");
    expect(appSource).toContain('"overlay/global_mouse_move"');
    expect(appSource).toContain("let overlaySyntheticMoveRelayActive = false;");
    expect(appSource).toContain("const relayOverlaySyntheticPointerMove = (event: MouseEvent) => {");
    expect(appSource).toContain("overlaySyntheticPointerActive");
    expect(appSource).toContain("overlaySyntheticPrimaryButtonDown");
    expect(appSource).toContain("overlaySyntheticPointerTarget");
    expect(appSource).toContain("new PointerEvent");
    expect(appSource).toContain('new MouseEvent("mousemove"');
    expect(globalMoveBlock).not.toContain("if (overlaySyntheticMoveRelayActive) return;");
    expect(globalMoveBlock).toContain("if (!overlaySyntheticMoveRelayActive && !draggingStickerId()) {");
    expect(globalMoveBlock).toContain("relayOverlaySyntheticPointerMove(e);");
    expect(globalMoveBlock).toContain("handleDragMove(e);");
  });

  it("skips per-frame top-strip backend rect sync while the edited sticker itself is being whole-dragged, so Ctrl+E mode does not add toolbar-follow lag that normal sticker drag does not have", () => {
    const topStripSource = readSource("src/components/StickerTopStrip.tsx");
    const syncEffectBlock = sourceBetween(
      topStripSource,
      "createEffect(() => {\n        if (typeof window === \"undefined\" || !stripRef) return;\n\n        layout();",
      "onCleanup(() => {",
    );

    expect(topStripSource).toContain("draggingStickerId");
    expect(topStripSource).toContain("const draggingThisSticker = createMemo(() => draggingStickerId() === props.unitId);");
    expect(syncEffectBlock).toContain("if (draggingThisSticker()) return;");
    expect(syncEffectBlock).toContain("addOrUpdateRect(buildStripInteractiveRect(stripRef, currentUnitId));");
    expect(syncEffectBlock).toContain("void syncService.updateBackendRects();");
  });
});
