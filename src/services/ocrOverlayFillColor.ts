//! Preserves per-region background evidence when migrating legacy OCR results.

export interface OcrOverlayColorSample {
    colorHex?: unknown;
    bgColorHex?: unknown;
}

export interface OcrOverlayFillColor {
    hex: string;
}

interface RgbColor {
    r: number;
    g: number;
    b: number;
}

const HEX_COLOR = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i;
const DEFAULT_FOREGROUND: RgbColor = { r: 0, g: 0, b: 0 };

const parseHexColor = (value: unknown): RgbColor | null => {
    if (typeof value !== "string") return null;
    const match = HEX_COLOR.exec(value);
    if (!match) return null;
    return {
        r: Number.parseInt(match[1].slice(0, 2), 16),
        g: Number.parseInt(match[1].slice(2, 4), 16),
        b: Number.parseInt(match[1].slice(4, 6), 16),
    };
};

const packRgb = (color: RgbColor) => (color.r << 16) | (color.g << 8) | color.b;
const unpackRgb = (packed: number): RgbColor => ({
    r: (packed >> 16) & 0xff,
    g: (packed >> 8) & 0xff,
    b: packed & 0xff,
});
const toHex = (color: RgbColor) => `#${packRgb(color).toString(16).padStart(6, "0")}`;

const relativeLuminance = (color: RgbColor) => {
    const linear = (channel: number) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
};

const contrastRatio = (left: RgbColor, right: RgbColor) => {
    const leftLuminance = relativeLuminance(left);
    const rightLuminance = relativeLuminance(right);
    return (Math.max(leftLuminance, rightLuminance) + 0.05)
        / (Math.min(leftLuminance, rightLuminance) + 0.05);
};

/** Legacy results have colors but no pixels; never invent a new highlight palette. */
export const resolveOcrOverlayFillColor = (
    block: OcrOverlayColorSample | null | undefined,
): OcrOverlayFillColor => ({ hex: toHex(parseHexColor(block?.bgColorHex) ?? unpackRgb(0xffffff)) });

/** Preserves sampled text color when readable, otherwise selects a neutral accessible foreground. */
export const resolveOcrOverlayTextColor = (source: unknown, fillHex: string): string => {
    const fill = parseHexColor(fillHex) ?? unpackRgb(0xffffff);
    const foreground = parseHexColor(source) ?? DEFAULT_FOREGROUND;
    if (contrastRatio(foreground, fill) >= 4.5) return toHex(foreground);
    const light = unpackRgb(0xf8fafc);
    const dark = unpackRgb(0x06080d);
    return toHex(
        contrastRatio(light, fill) >= contrastRatio(dark, fill) ? light : dark,
    );
};
