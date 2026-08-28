import { describe, expect, it } from "vitest";

import { resolveOcrOverlayFillColor } from "../../src/services/ocrOverlayFillColor";

const parseHex = (value: string) => [1, 3, 5].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
);

const colorDistance = (left: number[], rightHex: string) => {
    const right = parseHex(rightHex);
    return Math.sqrt(left.reduce((sum, channel, index) =>
        sum + (channel - right[index]) ** 2, 0));
};

describe("OCR overlay shared fill color", () => {
    it("returns one deterministic opaque third color for a sticker", () => {
        const blocks = [
            { colorHex: "#ffffff", bgColorHex: "#101010" },
            { colorHex: "#22c55e", bgColorHex: "#f7f8ef" },
            { colorHex: "#06080d", bgColorHex: "#d9ff38" },
        ];

        const fill = resolveOcrOverlayFillColor(blocks);

        expect(fill.hex).toMatch(/^#[0-9a-f]{6}$/);
        expect(Object.keys(fill)).toEqual(["hex"]);
        expect(blocks.flatMap((block) => [block.colorHex, block.bgColorHex]))
            .not.toContain(fill.hex);
        expect(resolveOcrOverlayFillColor([...blocks].reverse())).toEqual(fill);
        for (const block of blocks) {
            const visible = parseHex(fill.hex);
            expect(colorDistance(visible, block.colorHex)).toBeGreaterThan(20);
            expect(colorDistance(visible, block.bgColorHex)).toBeGreaterThan(20);
        }
    });

    it("uses a stable safe fallback for missing or malformed OCR colors", () => {
        const fallback = resolveOcrOverlayFillColor([]);

        expect(resolveOcrOverlayFillColor(undefined)).toEqual(fallback);
        expect(resolveOcrOverlayFillColor([
            { colorHex: "url(javascript:bad)", bgColorHex: "transparent" },
        ])).toEqual(fallback);
        expect(resolveOcrOverlayFillColor(
            {} as unknown as readonly { colorHex: string; bgColorHex: string }[],
        )).toEqual(fallback);
    });

    it("accepts eight-digit inputs while returning an opaque six-digit color", () => {
        const fill = resolveOcrOverlayFillColor([
            { colorHex: "#ffffff80", bgColorHex: "#000000cc" },
        ]);

        expect(fill.hex).toMatch(/^#[0-9a-f]{6}$/);
        expect(fill.hex).not.toBe("#ffffff");
        expect(fill.hex).not.toBe("#000000");
    });

    it("bounds work to the first 512 OCR blocks", () => {
        const boundedPrefix = Array.from({ length: 512 }, () => ({
            colorHex: "#ffffff",
            bgColorHex: "#000000",
        }));
        const ignoredTail = Array.from({ length: 128 }, (_, index) => ({
            colorHex: `#${(index + 1).toString(16).padStart(6, "0")}`,
            bgColorHex: "#abcdef",
        }));

        expect(resolveOcrOverlayFillColor([...boundedPrefix, ...ignoredTail]))
            .toEqual(resolveOcrOverlayFillColor(boundedPrefix));
    });
});
