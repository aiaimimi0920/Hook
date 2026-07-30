import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(
    resolve(process.cwd(), "src/components/UnitView.tsx"),
    "utf8",
);

describe("Hook art-node drag-out contract", () => {
    const extractSection = (startMarker: string, endMarker: string) => {
        const start = unitViewSource.indexOf(startMarker);
        const end = unitViewSource.indexOf(endMarker, start + startMarker.length);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        return unitViewSource.slice(start, end);
    };

    it("routes shift drag-export through a unit-level export planner instead of hard-blocking art nodes", () => {
        expect(unitViewSource).toContain("../services/unitDragExport");
        expect(unitViewSource).toContain("resolveUnitDragExportPlan");
    });

    it("does not keep the desktop shift-drag preflight gated to sticker-only units", () => {
        const overlayDownSection = extractSection(
            "const handlePendingNativeDragOverlayDown = (event: Event) => {",
            "const handlePendingNativeDragOverlayEnd =",
        );
        const pointerDownSection = extractSection(
            "const handleNativeStickerPointerDownCapture = (event: PointerEvent) => {",
            "createEffect(() => {",
        );
        const beginDragSection = extractSection(
            "const beginHookStickerExportDrag = async (globalX: number, globalY: number) => {",
            "const updateHookStickerExportDragPreview =",
        );

        expect(overlayDownSection).not.toContain('props.unit.type !== "sticker"');
        expect(pointerDownSection).not.toContain('props.unit.type !== "sticker"');
        expect(beginDragSection).toContain("resolveCurrentUnitDragExportPlan");
        expect(beginDragSection).toContain("exportPlan.kind");
    });
});
