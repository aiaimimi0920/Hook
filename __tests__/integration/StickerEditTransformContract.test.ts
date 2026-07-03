import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("sticker edit transform contract", () => {
  it("routes every sticker frame resize through edit-layer-aware graph actions", () => {
    const graphStoreSource = readSource("src/store/graphStore.ts");
    const unitViewSource = readSource("src/components/UnitView.tsx");
    const canvasUnitsSource = readSource("src/components/CanvasUnits.tsx");
    const propertyBarSource = readSource("src/components/StickerTopStripPropertyBar.tsx");
    const nodeParametersSource = readSource("src/hooks/useNodeParameters.ts");

    expect(graphStoreSource).toContain("scaleStickerEditDataForFrame");
    expect(graphStoreSource).toContain("resizeStickerFrame");
    expect(unitViewSource).toContain("props.onResize(nextFrame");
    expect(canvasUnitsSource).toContain("graphStore.actions.resizeStickerFrame(u.id");
    expect(propertyBarSource).toContain("graphStore.actions.resizeStickerFrame(props.unitId");
    expect(nodeParametersSource).toContain("graphStore.actions.resizeStickerFrame(unitId");
  });

  it("keeps ctrl-wheel whole-sticker resize responsive by deferring workflow sync off the hot path", () => {
    const canvasUnitsSource = readSource("src/components/CanvasUnits.tsx");
    const onResizeStart = canvasUnitsSource.indexOf("onResize={(nextFrame) => {");
    const onOpacityStart = canvasUnitsSource.indexOf("onOpacityChange={(val) => {");
    const onResizeSource = canvasUnitsSource.slice(onResizeStart, onOpacityStart);

    expect(canvasUnitsSource).toContain("const scheduleStickerResizeSync = () =>");
    expect(canvasUnitsSource).toContain("window.setTimeout(() => {");
    expect(canvasUnitsSource).toContain("void syncService.performWorkflowSync();");
    expect(onResizeSource).toContain("graphStore.actions.resizeStickerFrame(u.id, nextFrame);");
    expect(onResizeSource).toContain("scheduleStickerResizeSync();");
    expect(onResizeSource).not.toContain("syncService.updateBackendRects()");
    expect(onResizeSource).not.toContain("syncService.performWorkflowSync()");
  });

  it("applies sticker opacity at the visual layer so annotations fade with the image", () => {
    const unitViewSource = readSource("src/components/UnitView.tsx");

    expect(unitViewSource).toContain('class="sticker-visual"');
    expect(unitViewSource).toContain('"opacity": getOpacity()');
    expect(unitViewSource).toContain("opacity={1}");
    expect(unitViewSource).not.toContain('"opacity": getImageOpacity()');
  });
});
