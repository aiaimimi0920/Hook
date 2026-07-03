import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("context-menu hit-test contract", () => {
    it("registers the menu overlay rectangle through the shared UI registry path", () => {
        const layer = readSource("src/components/StickerContextMenuLayer.tsx");

        expect(layer).toContain("addOrUpdateRect");
        expect(layer).toContain("removeRect");
        expect(layer).toContain("getBoundingClientRect");
    });

    it("swallows pointer and context-menu events at the menu root so blank gaps do not click through", () => {
        const layer = readSource("src/components/StickerContextMenuLayer.tsx");

        expect(layer).toContain("onMouseDown");
        expect(layer).toContain("onMouseUp");
        expect(layer).toContain("onClick");
        expect(layer).toContain("onContextMenu");
    });

    it("renders the context menu above the selected sticker z-layer", () => {
        const layer = readSource("src/components/StickerContextMenuLayer.tsx");
        const unitView = readSource("src/components/UnitView.tsx");

        const menuZIndexMatch = layer.match(/z-\[(\d+)\]/);
        const selectedUnitZIndexMatch = unitView.match(/"z-index": props\.isSelected \? (\d+) : \d+/);

        expect(menuZIndexMatch).not.toBeNull();
        expect(selectedUnitZIndexMatch).not.toBeNull();
        expect(Number(menuZIndexMatch?.[1])).toBeGreaterThan(Number(selectedUnitZIndexMatch?.[1]));
    });
});
