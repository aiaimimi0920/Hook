import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dragSource = readFileSync(resolve(process.cwd(), "src/hooks/useDraggable.ts"), "utf8");

const sourceBetween = (source: string, start: string, end: string) => {
    const startIndex = source.indexOf(start);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    const endIndex = source.indexOf(end, startIndex + start.length);
    expect(endIndex).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
};

describe("sticker drag sync contract", () => {
    it("clears transient drag UI state before scheduling backend sync work, so drag release is not blocked by Hook/Loom sync latency", () => {
        const handleDragEndBlock = sourceBetween(
            dragSource,
            "const handleDragEnd = async () => {",
            "return { startDrag, handleDragMove, handleDragEnd };",
        );

        const clearDragIndex = handleDragEndBlock.lastIndexOf("setDraggingStickerId(null);");
        const clearMultiIndex = handleDragEndBlock.lastIndexOf("setMultiDragPositions(null);");
        const syncIndex = handleDragEndBlock.indexOf("syncService.updateBackendRects()");

        expect(syncIndex).toBeGreaterThanOrEqual(0);
        expect(clearDragIndex).toBeGreaterThanOrEqual(0);
        expect(clearMultiIndex).toBeGreaterThanOrEqual(0);
        expect(clearDragIndex).toBeLessThan(syncIndex);
        expect(clearMultiIndex).toBeLessThan(syncIndex);
    });
});
