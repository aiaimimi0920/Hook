import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");
const canvasInteractionSource = readFileSync(
  resolve(process.cwd(), "src/services/appCanvasInteractions.ts"),
  "utf8",
);
const annotationSource = readFileSync(
  resolve(process.cwd(), "src/components/stickerAnnotationPointerDownController.ts"),
  "utf8",
);

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

describe("sticker selection focus contract", () => {
  it("focuses Hook after drag-out, capture-mode, and locked-group guards accept the sticker interaction", () => {
    const block = sourceBetween(
      canvasInteractionSource,
      "const onStartDragUnit =",
      "const resolveUnitImage =",
    );
    const dragOutGuardIndex = block.indexOf('checkDragModifier(event, "dragOut")');
    const captureGuardIndex = block.indexOf("if (isSelecting())");
    const lockedGuardIndex = block.indexOf("if (targetGroup?.locked)");
    const focusIndex = block.indexOf("api.focusOverlayWindow()");

    expect(dragOutGuardIndex).toBeGreaterThan(-1);
    expect(captureGuardIndex).toBeGreaterThan(dragOutGuardIndex);
    expect(lockedGuardIndex).toBeGreaterThan(captureGuardIndex);
    expect(focusIndex).toBeGreaterThan(lockedGuardIndex);
    expect(appSource).toContain("createAppCanvasInteractions");
  });

  it("focuses Hook for annotation interactions that consume the sticker pointer event", () => {
    const block = sourceBetween(
      annotationSource,
      "const handleExistingPointerDown = async",
      "const handleCreatePointerDown = async",
    );
    const passThroughIndex = block.indexOf("if (shouldPassThroughToStickerDrag)");
    const focusIndex = block.indexOf("api.focusOverlayWindow()");

    expect(passThroughIndex).toBeGreaterThan(-1);
    expect(focusIndex).toBeGreaterThan(passThroughIndex);
  });
});
