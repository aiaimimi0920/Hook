import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const actionsSource = readFileSync(resolve(process.cwd(), "src/hooks/useUnitActions.ts"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const javaScriptSurfaceSource = readFileSync(resolve(process.cwd(), "src/components/JavaScriptSurface.tsx"), "utf8");
const stickerEditingSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditing.ts"), "utf8");
const artSurfaceViewsSource = readFileSync(resolve(process.cwd(), "src/services/artSurfaceViews.ts"), "utf8");
const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const graphStoreSource = readFileSync(resolve(process.cwd(), "src/store/graphStore.ts"), "utf8");

describe("Hook sticker double-click contract", () => {
    it("derives double-click minify from the actual sticker visual rect and routes the crop math through the shared helper so every corner uses the same edge handling", () => {
        expect(actionsSource).toContain("computeMinifiedStickerWindow(");
        expect(actionsSource).toContain("resolveStickerSurfaceDoubleClickTarget(");
        expect(actionsSource).toContain("?? (e.currentTarget instanceof HTMLElement ? e.currentTarget : null);");
        expect(actionsSource).toContain("if (!target) return;");
        expect(actionsSource).toContain("const rect = target.getBoundingClientRect();");
        expect(actionsSource).toContain("|| rect.width <= 0");
        expect(actionsSource).toContain("|| rect.height <= 0");
        expect(actionsSource).toContain("const relX = (e.clientX - rect.left) / rect.width;");
        expect(actionsSource).toContain("const relY = (e.clientY - rect.top) / rect.height;");
        expect(actionsSource).toContain("const minified = computeMinifiedStickerWindow(");
        expect(actionsSource).toContain("x: minified.frame.x,");
        expect(actionsSource).toContain("y: minified.frame.y,");
        expect(actionsSource).toContain("savedRect: minified.savedRect,");
        expect(actionsSource).toContain("cropOffset: minified.cropOffset,");
        expect(actionsSource).toContain("setDraggingStickerId(null);");
        expect(actionsSource).toContain("setMultiDragPositions(null);");
        expect(actionsSource).toContain("sticker-double-click-window");
        expect(actionsSource).not.toContain(
            "syncService.updateBackendRects();\n                   syncService.performWorkflowSync();",
        );
        expect(actionsSource).not.toContain("setTimeout(() => {\n              syncService.performWorkflowSync();");
        expect(actionsSource).toContain("void syncService.performWorkflowSync();");
        expect(unitViewSource).toContain('"pointer-events": "none"');
        expect(unitViewSource).toContain("data-hook-drag-follow-unit-id={props.unit.id}");
        expect(unitViewSource).not.toContain("props.dragPosition");
        expect(unitViewSource).toContain('data-sticker-base-image="true"');
        expect(unitViewSource).toContain("baseImageIntrinsicSize() || undefined");
        expect(unitViewSource).toContain("setBaseImageIntrinsicSize({ w: naturalWidth, h: naturalHeight });");
        expect(unitViewSource).not.toContain("if (draggingStickerId() && props.multiDragPositions");
    });

    it("clears drag state before restoring a minified sticker so the render position cannot stay pinned to the mini sticker location", () => {
        const restoreMatch = actionsSource.match(/if \(u\.data\.minified\) \{([\s\S]*?)return;/);
        expect(restoreMatch?.[1]).toBeTruthy();
        const restoreBranch = restoreMatch![1];
        expect(restoreBranch).toContain("setDraggingStickerId(null);");
        expect(restoreBranch).toContain("setMultiDragPositions(null);");
        expect(restoreBranch).toContain("computeRestoredMinifiedStickerWindow(");
        expect(restoreBranch).toContain("u.data.cropOffset");
        expect(restoreBranch).toContain("graphStore.actions.updateStickerWindowState(");
    });

    it("renders crop-then-minify against the combined source crop plus mini crop instead of shrinking the original full image into the mini sticker", () => {
        expect(stickerEditingSource).toContain("export const computeMinifiedStickerViewport = (");
        expect(stickerEditingSource).toContain("offsetX: cropRect.x + baseOffsetX");
        expect(stickerEditingSource).toContain("offsetY: cropRect.y + baseOffsetY");
        expect(unitViewSource).toContain("computeMinifiedStickerViewport(");
    });

    it("keeps an Art Surface at its pre-double-click presentation scale and clips the compact window around the clicked region", () => {
        expect(unitViewSource).toContain("computeSurfaceViewWindowPresentation(unit, selectedSurfaceView()");
        expect(unitViewSource).toContain("minified: unit.data.minified");
        expect(unitViewSource).toContain("savedRect: unit.data.savedRect");
        expect(unitViewSource).toContain("cropOffset: unit.data.cropOffset");
        expect(artSurfaceViewsSource).toContain("const windowBase = options.minified && options.savedRect");
        expect(artSurfaceViewsSource).toContain("left: presentation.left - (options.cropOffset?.x ?? 0)");
        expect(artSurfaceViewsSource).toContain("never resize the Surface to the visible window");
    });

    it("routes an Art Surface background double-click through the real iframe DOM so UnitView receives valid event targets", () => {
        expect(javaScriptSurfaceSource).toContain('iframe.dispatchEvent(new MouseEvent("dblclick", {');
        expect(javaScriptSurfaceSource).not.toContain("props.onBackgroundDoubleClick?.(");
        expect(javaScriptSurfaceSource).not.toContain("onBackgroundDoubleClick?:");
        expect(unitViewSource).not.toContain("onBackgroundDoubleClick={(event) => props.onDoubleTap(event)}");
    });

    it("only forwards sticker double-click zoom from the sticker visual surface, never from toolbar controls", () => {
        expect(unitViewSource).toContain("isStickerSurfaceDoubleClickTarget");
        expect(unitViewSource).toContain("const handleUnitDoubleClick = (event: MouseEvent) =>");
        expect(unitViewSource).toContain("!isStickerSurfaceDoubleClickTarget(event.target, event.currentTarget)");
        expect(unitViewSource).toContain("onDblClick={handleUnitDoubleClick}");
        expect(unitViewSource).not.toContain("onDblClick={props.onDoubleTap}");
        expect(topStripSource).toContain("onMouseDown={(event) => event.stopPropagation()}");
        expect(propertyBarSource).toContain("event.stopPropagation();");
        expect(propertyBarSource).toContain("api.focusOverlayWindow()");
    });

    it("publishes minified geometry atomically and hides the retained editable SVG stack behind one cached bitmap", () => {
        expect(graphStoreSource).toContain("setUnits(match, (previous) => ({");
        expect(unitViewSource).toContain("const minifiedBakedPreviewSrc = createMemo(() => {");
        expect(unitViewSource).toContain("bakedSyncPreviewCacheRevision();");
        expect(unitViewSource).toContain("resolveCachedBakedSyncPreview(unit, displaySrcOverride ?? null)");
        expect(unitViewSource).toContain('data-sticker-minified-baked-preview="true"');
        expect(unitViewSource).toContain('display: minifiedBakedPreviewSrc() ? "none" : "block"');
        expect(unitViewSource).toContain('props.unit.type === "sticker"');
    });
});
