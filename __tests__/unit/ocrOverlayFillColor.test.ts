import { describe, expect, it } from "vitest";

import {
    resolveOcrOverlayFillColor,
    resolveOcrOverlayTextColor,
} from "../../src/services/ocrOverlayFillColor";

const parseHex = (value: string) => [1, 3, 5].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
);

const colorDistance = (left: number[], rightHex: string) => {
    const right = parseHex(rightHex);
    return Math.sqrt(left.reduce((sum, channel, index) =>
        sum + (channel - right[index]) ** 2, 0));
};

const contrastRatio = (leftHex: string, rightHex: string) => {
    const luminance = (hex: string) => {
        const channels = parseHex(hex).map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const left = luminance(leftHex);
    const right = luminance(rightHex);
    return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
};

const isRedLike = (hex: string) => {
    const [red, green, blue] = parseHex(hex);
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    if (maximum === minimum) return false;
    const hue = maximum === red
        ? 60 * (((green - blue) / (maximum - minimum)) % 6)
        : maximum === green
            ? 60 * ((blue - red) / (maximum - minimum) + 2)
            : 60 * ((red - green) / (maximum - minimum) + 4);
    const normalizedHue = hue < 0 ? hue + 360 : hue;
    return normalizedHue <= 30 || normalizedHue >= 300;
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

    it("never uses red or red-adjacent fills for ordinary OCR content", () => {
        const fill = resolveOcrOverlayFillColor([
            { colorHex: "#f7f8ef", bgColorHex: "#090c11" },
            { colorHex: "#929a9f", bgColorHex: "#090c11" },
        ]);

        expect(isRedLike(fill.hex)).toBe(false);
        expect(contrastRatio(fill.hex, "#f7f8ef")).toBeGreaterThanOrEqual(4.5);
    });

    it("replaces an antialiased low-contrast sample with a readable neutral foreground", () => {
        const fill = "#140b42";
        const text = resolveOcrOverlayTextColor("#727272", fill);

        expect(text).toBe("#f8fafc");
        expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(4.5);
        expect(resolveOcrOverlayTextColor("#f8fafc", fill)).toBe("#f8fafc");
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
