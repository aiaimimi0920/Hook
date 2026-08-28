import { describe, expect, it } from "vitest";

import { buildStickerTopStripInteractiveRect } from "../../src/components/stickerTopStripInteractiveRect";

const bounds = (left: number, top: number, right: number, bottom: number) => ({
    left,
    top,
    right,
    bottom,
});

describe("sticker top-strip interactive rect", () => {
    it("includes an open OCR submenu in the native hit-test union", () => {
        const children = [
            { getBoundingClientRect: () => bounds(100, 50, 150, 100) },
            { getBoundingClientRect: () => bounds(100, 101, 245, 141) },
        ];
        const root = {
            getBoundingClientRect: () => bounds(100, 50, 650, 100),
            querySelectorAll: () => children,
        } as unknown as HTMLDivElement;

        expect(buildStickerTopStripInteractiveRect(root, "ocr-unit")).toEqual({
            id: "sticker-top-strip-ocr-unit",
            x: 100,
            y: 50,
            width: 550,
            height: 91,
            name: "STICKER_TOP_STRIP",
        });
    });
});
