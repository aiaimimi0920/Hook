// Beautify mode: wrap a sticker composite in a padded, rounded, shadowed frame
// over a gradient or solid background (inspired by capcap's beautify mode).
//
// Rendering is applied at export time: the inner sticker composite is drawn
// first, then placed onto a larger "beautified" canvas. The layout math is
// pure so it can be unit tested without a canvas.

import type { StickerBeautifyState } from "../types/stickerEditing";

export interface BeautifyBackground {
    id: string;
    label: string;
    kind: "solid" | "gradient";
    // For solid: a single CSS color. For gradient: ordered color stops painted
    // along the canvas diagonal.
    colors: string[];
}

export const BEAUTIFY_BACKGROUNDS: BeautifyBackground[] = [
    { id: "sunset", label: "日落", kind: "gradient", colors: ["#ff7e5f", "#feb47b"] },
    { id: "ocean", label: "海洋", kind: "gradient", colors: ["#2193b0", "#6dd5ed"] },
    { id: "violet", label: "紫罗兰", kind: "gradient", colors: ["#8e2de2", "#4a00e0"] },
    { id: "mint", label: "薄荷", kind: "gradient", colors: ["#11998e", "#38ef7d"] },
    { id: "slate", label: "石板", kind: "gradient", colors: ["#232526", "#414345"] },
    { id: "white", label: "纯白", kind: "solid", colors: ["#ffffff"] },
    { id: "graphite", label: "石墨", kind: "solid", colors: ["#1f2933"] },
];

export const DEFAULT_BEAUTIFY_BACKGROUND_ID = "sunset";

export const createDefaultBeautifyState = (): StickerBeautifyState => ({
    enabled: false,
    backgroundId: DEFAULT_BEAUTIFY_BACKGROUND_ID,
    padding: 48,
    cornerRadius: 16,
    shadow: true,
});

export const resolveBeautifyBackground = (id: string): BeautifyBackground =>
    BEAUTIFY_BACKGROUNDS.find((background) => background.id === id) ?? BEAUTIFY_BACKGROUNDS[0];

export interface BeautifyLayout {
    outerWidth: number;
    outerHeight: number;
    innerX: number;
    innerY: number;
    innerWidth: number;
    innerHeight: number;
}

/**
 * Compute the beautified canvas size and the inset rect where the inner
 * composite is drawn. Padding is clamped to non-negative; the inner content
 * keeps its pixel size and is simply centered with `padding` on every side.
 */
export const computeBeautifyLayout = (
    innerWidth: number,
    innerHeight: number,
    padding: number,
): BeautifyLayout => {
    const safePadding = Math.max(0, Math.round(padding));
    const safeInnerWidth = Math.max(1, Math.round(innerWidth));
    const safeInnerHeight = Math.max(1, Math.round(innerHeight));
    return {
        outerWidth: safeInnerWidth + safePadding * 2,
        outerHeight: safeInnerHeight + safePadding * 2,
        innerX: safePadding,
        innerY: safePadding,
        innerWidth: safeInnerWidth,
        innerHeight: safeInnerHeight,
    };
};

/**
 * Paint the configured background across the whole beautified canvas.
 * Gradients run along the top-left -> bottom-right diagonal.
 */
export const paintBeautifyBackground = (
    context: CanvasRenderingContext2D,
    background: BeautifyBackground,
    width: number,
    height: number,
) => {
    if (background.kind === "solid" || background.colors.length < 2) {
        context.fillStyle = background.colors[0] ?? "#ffffff";
        context.fillRect(0, 0, width, height);
        return;
    }
    const gradient = context.createLinearGradient(0, 0, width, height);
    const stops = background.colors;
    stops.forEach((color, index) => {
        gradient.addColorStop(stops.length === 1 ? 0 : index / (stops.length - 1), color);
    });
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
};
