/** Pure color normalization and bounded numeric style helpers. */
import type { StickerColorState } from "../types/stickerEditing";
import { TRANSPARENT_STICKER_COLOR } from "./stickerEditingDefaults";

export const getEffectiveStickerColor = (colors: StickerColorState, preferSampled = false) =>
    preferSampled && colors.sampledColor ? colors.sampledColor : colors.activeColor;

/** Returns the alpha encoded in a sticker color, or one for opaque values. */
export const getStickerColorAlpha = (color: string | undefined): number => {
    if (!color) return 0;
    const trimmed = color.trim().toLowerCase();
    if (trimmed === TRANSPARENT_STICKER_COLOR) return 0;
    const hex = trimmed.replace(/^#/, "");
    if (/^[0-9a-f]{8}$/.test(hex)) {
        return parseInt(hex.slice(6, 8), 16) / 255;
    }
    return 1;
};

export const isTransparentStickerColor = (color: string | undefined) =>
    !color ||
    color.trim().toLowerCase() === TRANSPARENT_STICKER_COLOR ||
    getStickerColorAlpha(color) === 0;

export const normalizeStickerPaletteColor = (color: string) => {
    const trimmed = color.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === TRANSPARENT_STICKER_COLOR) {
        return TRANSPARENT_STICKER_COLOR;
    }

    const normalized = trimmed.replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
        return `#${normalized
            .split("")
            .map((part) => `${part}${part}`)
            .join("")
            .toLowerCase()}`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return `#${normalized.toLowerCase()}`;
    }
    if (/^[0-9a-fA-F]{8}$/.test(normalized)) {
        const hex = normalized.toLowerCase();
        const alpha = parseInt(hex.slice(6, 8), 16);
        if (alpha === 0) {
            return TRANSPARENT_STICKER_COLOR;
        }
        return `#${hex}`;
    }
    return null;
};

export const addStickerPaletteColor = (palette: string[], color: string) => {
    const normalized = normalizeStickerPaletteColor(color);
    if (!normalized || palette.includes(normalized)) {
        return palette;
    }
    return [...palette, normalized];
};

export const removeStickerPaletteColor = (palette: string[], color: string) => {
    const normalized = normalizeStickerPaletteColor(color);
    if (!normalized) {
        return palette;
    }
    return palette.filter((item) => item !== normalized);
};

export const parseHexColor = (hex: string): { r: number; g: number; b: number } | undefined => {
    const normalized = hex.trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(normalized) && !/^[0-9a-fA-F]{8}$/.test(normalized)) {
        return undefined;
    }

    return {
        r: Number.parseInt(normalized.slice(0, 2), 16),
        g: Number.parseInt(normalized.slice(2, 4), 16),
        b: Number.parseInt(normalized.slice(4, 6), 16),
    };
};

export const formatRgbColor = (rgb: { r: number; g: number; b: number }) =>
    `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

export const adjustStickerOpacity = (current: number, delta: number, min = 0, max = 1) => {
    const next = Math.min(max, Math.max(min, current + delta));
    return Math.round(next * 10) / 10;
};

export const adjustStrokeWidth = (current: number, delta: number, min = 0, max = 16) =>
    Math.min(max, Math.max(min, current + delta));

export const adjustTextSize = (current: number, delta: number, min = 10, max = 48) =>
    Math.min(max, Math.max(min, current + delta));

export const adjustEffectStrength = (current: number, delta: number, min = 2, max = 64) =>
    Math.min(max, Math.max(min, current + delta));

export const buildSerialAnnotationMetrics = (radius: number) => {
    const finiteRadius = Number.isFinite(radius) ? radius : 14;
    const safeRadius = Math.min(96, Math.max(8, Math.round(finiteRadius)));
    return {
        radius: safeRadius,
        fontSize: Math.max(10, Math.round(safeRadius * 1.15)),
        borderWidth: Math.max(1, Math.round(safeRadius / 7)),
    };
};
