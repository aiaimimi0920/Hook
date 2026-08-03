import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const actionsSource = readFileSync(resolve(process.cwd(), "src/hooks/useUnitActions.ts"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const stickerEditingSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditing.ts"), "utf8");
const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");

describe("Hook sticker double-click contract", () => {
    it("derives double-click minify from the actual sticker visual rect and routes the crop math through the shared helper so every corner uses the same edge handling", () => {
        expect(actionsSource).toContain("computeMinifiedStickerWindow(");
        expect(actionsSource).toContain("resolveStickerSurfaceDoubleClickTarget(");
        expect(actionsSource).toContain("const target = resolveStickerSurfaceDoubleClickTarget(e.target, e.currentTarget) ?? (e.currentTarget as HTMLElement);");
        expect(actionsSource).toContain("const rect = target.getBoundingClientRect();");
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
});
