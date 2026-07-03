import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const actionsSource = readFileSync(resolve(process.cwd(), "src/hooks/useUnitActions.ts"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const stickerEditingSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditing.ts"), "utf8");
const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");

describe("Hook sticker double-click contract", () => {
    it("uses the pre-foundation double-click minify math so the clicked point remains centered in the cropped window", () => {
        expect(actionsSource).toContain("const target = e.currentTarget as HTMLElement;");
        expect(actionsSource).toContain("const rect = target.getBoundingClientRect();");
        expect(actionsSource).toContain("const clickUnitX = relX * u.w;");
        expect(actionsSource).toContain("const clickUnitY = relY * u.h;");
        expect(actionsSource).toContain("const CROP_SIZE = 100;");
        expect(actionsSource).toContain("const offsetX = clickUnitX - (CROP_SIZE / 2);");
        expect(actionsSource).toContain("const offsetY = clickUnitY - (CROP_SIZE / 2);");
        expect(actionsSource).toContain("const newX = u.x + offsetX;");
        expect(actionsSource).toContain("const newY = u.y + offsetY;");
        expect(actionsSource).toContain("setDraggingStickerId(null);");
        expect(actionsSource).toContain("setMultiDragPositions(null);");
        expect(actionsSource).toContain("sticker-double-click-window");
        expect(unitViewSource).toContain('"pointer-events": "none"');
        expect(unitViewSource).toContain("if (draggingStickerId() && props.multiDragPositions");
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
        expect(propertyBarSource).toContain("onMouseDown={(event) => event.stopPropagation()}");
    });
});
