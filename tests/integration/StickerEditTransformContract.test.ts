import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");
const schedulerSource = readSource("src/features/stickers/services/stickerEditSyncScheduler.ts");

describe("sticker edit transform contract", () => {
  it("routes every sticker frame resize through edit-layer-aware graph actions", () => {
    const graphStoreSource = readSource("src/features/workspace/state/graphStore.ts");
    const unitViewSource = readSource("src/features/workspace/components/UnitView.tsx");
    const canvasUnitsSource = readSource("src/features/workspace/components/CanvasUnits.tsx");
    const propertyBarSource = readSource("src/features/stickers/components/StickerTopStripPropertyBar.tsx");
    const propertyBarCropSource = readSource("src/features/stickers/components/stickerTopStripPropertyBarCropController.ts");
    const nodeParametersSource = readSource("src/features/art/hooks/useNodeParameters.ts");

    expect(graphStoreSource).toContain("scaleStickerEditDataForFrame");
    expect(graphStoreSource).toContain("resizeStickerFrame");
    expect(unitViewSource).toContain("props.onResize(computeStickerWheelResizeFrame(");
    expect(canvasUnitsSource).toContain("graphStore.actions.resizeStickerFrame(u.id");
    expect(propertyBarSource).toContain("createPropertyBarCropController");
    expect(propertyBarCropSource).toMatch(/graphStore\.actions\.resizeStickerFrame\(\s*options\.unitId\(\)/);
    expect(nodeParametersSource).toContain("graphStore.actions.resizeStickerFrame(unitId");
  });

  it("keeps ctrl-wheel whole-sticker resize responsive by deferring workflow sync off the hot path", () => {
    const canvasUnitsSource = readSource("src/features/workspace/components/CanvasUnits.tsx");
    const onResizeStart = canvasUnitsSource.indexOf("onResize={(nextFrame) => {");
    const onOpacityStart = canvasUnitsSource.indexOf("onOpacityChange={(val) => {");
    const onResizeSource = canvasUnitsSource.slice(onResizeStart, onOpacityStart);

    expect(canvasUnitsSource).toContain("createStickerEditSyncScheduler");
    expect(schedulerSource).toContain("debounceMs: number");
    expect(schedulerSource).toContain("pendingResizeUnitIds");
    expect(schedulerSource).toContain("propagateResize(resizeUnitId);");
    expect(schedulerSource).toContain("void performSync();");
    expect(onResizeSource).toContain("graphStore.actions.resizeStickerFrame(u.id, nextFrame, { propagate: false });");
    expect(onResizeSource).toContain("stickerEditSync.scheduleResize(u.id);");
    expect(onResizeSource).not.toContain("syncService.updateBackendRects()");
    expect(onResizeSource).not.toContain("syncService.performWorkflowSync()");
  });

  it("debounces opacity wheel sync as well, so alt-wheel transparency edits do not run workflow sync on every wheel tick", () => {
    const canvasUnitsSource = readSource("src/features/workspace/components/CanvasUnits.tsx");
    const onOpacityStart = canvasUnitsSource.indexOf("onOpacityChange={(val) => {");
    const dataResolutionStart = canvasUnitsSource.indexOf("// Data Resolution", onOpacityStart);
    const onOpacitySource = canvasUnitsSource.slice(onOpacityStart, dataResolutionStart);

    expect(canvasUnitsSource).toContain("stickerEditSync.scheduleAppearance();");
    expect(schedulerSource).toContain("scheduleAppearance()");
    expect(onOpacitySource).not.toContain("syncService.performWorkflowSync()");
  });

  it("applies sticker opacity at the visual layer so annotations fade with the image", () => {
    const unitViewSource = readSource("src/features/workspace/components/UnitView.tsx");
    const surfaceContentSource = readSource("src/features/surfaces/components/UnitSurfaceContent.tsx");

    expect(unitViewSource).toContain('class="sticker-visual"');
    expect(unitViewSource).toContain('"opacity": image.opacity()');
    expect(surfaceContentSource).toContain("opacity={1}");
    expect(unitViewSource).not.toContain('"opacity": getImageOpacity()');
  });
});
