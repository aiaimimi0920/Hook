import { clamp } from "../utils/math";

export const STICKER_TOP_STRIP_SLOT_WIDTH = 28;
export const STICKER_TOP_STRIP_SLOT_COUNT = 13;
const STICKER_TOP_STRIP_DIVIDERS_WIDTH = 16;
// Match the shell's 5px horizontal / 4px vertical padding and 1px border.
const STICKER_TOP_STRIP_SHELL_WIDTH = 12;
const STICKER_TOP_STRIP_SHELL_HEIGHT = 10;
// 圆角外壳向左盖过贴图外侧的选中描边，避免左上角露出白边。
const STICKER_TOP_STRIP_LEFT_OVERHANG = 12;
export const STICKER_TOP_STRIP_MIN_WIDTH = STICKER_TOP_STRIP_SLOT_WIDTH * STICKER_TOP_STRIP_SLOT_COUNT
    + STICKER_TOP_STRIP_DIVIDERS_WIDTH + STICKER_TOP_STRIP_SHELL_WIDTH;
export const STICKER_TOP_STRIP_HEIGHT = STICKER_TOP_STRIP_SLOT_WIDTH + STICKER_TOP_STRIP_SHELL_HEIGHT;
export const STICKER_TOP_STRIP_PROPERTY_BAR_HEIGHT = 40;

interface StickerTopStripAnchor {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface StickerTopStripFrame {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface StickerTopStripLayout {
    container: StickerTopStripFrame;
    mainBar: StickerTopStripFrame;
    propertyBar: StickerTopStripFrame | null;
}

export const computeStickerTopStripFrame = (
    anchor: StickerTopStripAnchor,
    viewportWidth: number,
    viewportHeight: number,
): StickerTopStripFrame => {
    const safeViewportWidth = Math.max(0, Math.round(viewportWidth));
    const safeViewportHeight = Math.max(0, Math.round(viewportHeight));
    const width = Math.min(STICKER_TOP_STRIP_MIN_WIDTH, safeViewportWidth);
    const maxLeft = Math.max(0, safeViewportWidth - width);
    const left = clamp(Math.round(anchor.x) - STICKER_TOP_STRIP_LEFT_OVERHANG, 0, maxLeft);

    const preferredAboveTop = anchor.y - STICKER_TOP_STRIP_HEIGHT;
    const preferredBelowTop = anchor.y + anchor.h;
    const maxTop = Math.max(0, safeViewportHeight - STICKER_TOP_STRIP_HEIGHT);
    const canFitAbove = preferredAboveTop >= 0;
    const canFitBelow = preferredBelowTop + STICKER_TOP_STRIP_HEIGHT <= safeViewportHeight;

    let top: number;
    if (canFitAbove) {
        top = preferredAboveTop;
    } else if (canFitBelow) {
        top = preferredBelowTop;
    } else {
        const availableAbove = Math.max(0, Math.min(Math.round(anchor.y), safeViewportHeight));
        const availableBelow = Math.max(
            0,
            safeViewportHeight - Math.round(anchor.y + anchor.h),
        );
        top = availableAbove >= availableBelow ? 0 : maxTop;
    }

    return {
        left,
        top: clamp(top, 0, maxTop),
        width,
        height: STICKER_TOP_STRIP_HEIGHT,
    };
};

export const computeStickerTopStripLayout = (
    anchor: StickerTopStripAnchor,
    viewportWidth: number,
    viewportHeight: number,
    showPropertyBar: boolean,
    additionalSlots = 0,
): StickerTopStripLayout => {
    const safeViewportWidth = Math.max(0, Math.round(viewportWidth));
    const safeViewportHeight = Math.max(0, Math.round(viewportHeight));
    const boundedAdditionalSlots = Math.max(0, Math.min(8, Math.floor(additionalSlots)));
    const desiredWidth = STICKER_TOP_STRIP_MIN_WIDTH + boundedAdditionalSlots * STICKER_TOP_STRIP_SLOT_WIDTH;
    const width = Math.min(desiredWidth, safeViewportWidth);
    // Existing property controls must not be clipped by the narrower primary strip.
    const containerWidth = showPropertyBar ? Math.min(Math.max(width, 550), safeViewportWidth) : width;
    const maxLeft = Math.max(0, safeViewportWidth - containerWidth);
    const left = clamp(Math.round(anchor.x) - STICKER_TOP_STRIP_LEFT_OVERHANG, 0, maxLeft);
    const propertyBarHeight = showPropertyBar ? STICKER_TOP_STRIP_PROPERTY_BAR_HEIGHT : 0;
    const contentWidth = width - STICKER_TOP_STRIP_SHELL_WIDTH - STICKER_TOP_STRIP_DIVIDERS_WIDTH;
    const columns = Math.max(1, Math.floor(contentWidth / STICKER_TOP_STRIP_SLOT_WIDTH));
    const mainBarHeight = Math.ceil((STICKER_TOP_STRIP_SLOT_COUNT + boundedAdditionalSlots) / columns)
        * STICKER_TOP_STRIP_SLOT_WIDTH + STICKER_TOP_STRIP_SHELL_HEIGHT;
    const totalHeight = mainBarHeight + propertyBarHeight;

    const preferredAboveTop = anchor.y - totalHeight;
    const preferredBelowTop = anchor.y + anchor.h;
    const maxTop = Math.max(0, safeViewportHeight - totalHeight);
    const canFitAbove = preferredAboveTop >= 0;
    const canFitBelow = preferredBelowTop + totalHeight <= safeViewportHeight;

    let containerTop: number;
    if (canFitAbove) {
        containerTop = preferredAboveTop;
    } else if (canFitBelow) {
        containerTop = preferredBelowTop;
    } else {
        const availableAbove = Math.max(0, Math.min(Math.round(anchor.y), safeViewportHeight));
        const availableBelow = Math.max(
            0,
            safeViewportHeight - Math.round(anchor.y + anchor.h),
        );
        containerTop = availableAbove >= availableBelow ? 0 : maxTop;
    }

    const top = clamp(containerTop, 0, maxTop);
    const propertyBar = showPropertyBar
        ? {
              left,
              top,
              width: containerWidth,
              height: STICKER_TOP_STRIP_PROPERTY_BAR_HEIGHT,
          }
        : null;

    return {
        container: {
            left,
            top,
            width: containerWidth,
            height: totalHeight,
        },
        mainBar: {
            left,
            top: top + propertyBarHeight,
            width,
            height: mainBarHeight,
        },
        propertyBar,
    };
};
