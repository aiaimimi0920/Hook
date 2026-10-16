/**
 * Measures the top strip and its open menus as one native-interactive region.
 * Menu geometry must be included because the host window is click-through
 * outside registered rectangles.
 */
export const buildStickerTopStripInteractiveRect = (root: HTMLDivElement, unitId: string) => {
    const rootBounds = root.getBoundingClientRect();
    let left = rootBounds.left;
    let top = rootBounds.top;
    let right = rootBounds.right;
    let bottom = rootBounds.bottom;

    root.querySelectorAll<HTMLElement>("button, input, select, [data-top-strip-menu='true']").forEach((element) => {
        const bounds = element.getBoundingClientRect();
        left = Math.min(left, bounds.left);
        top = Math.min(top, bounds.top);
        right = Math.max(right, bounds.right);
        bottom = Math.max(bottom, bounds.bottom);
    });

    return {
        id: `sticker-top-strip-${unitId}`,
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        name: "STICKER_TOP_STRIP",
    };
};
