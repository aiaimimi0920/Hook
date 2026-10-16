// All dimensions use WebView-local CSS pixels, including monitor bounds.
export interface MenuBounds { left: number; top: number; width: number; height: number }
interface MenuSize { width: number; height: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

export function placeStickerContextMenu(anchor: { x: number; y: number }, size: MenuSize, bounds: MenuBounds) {
    return {
        left: clamp(anchor.x, bounds.left, bounds.left + bounds.width - size.width),
        top: clamp(anchor.y, bounds.top, bounds.top + bounds.height - size.height),
    };
}

export function placeStickerSubmenu(primary: MenuBounds, rowTop: number, size: MenuSize, bounds: MenuBounds) {
    const right = primary.left + primary.width;
    const fitsRight = right + size.width <= bounds.left + bounds.width;
    const leftSpace = primary.left - bounds.left;
    const rightSpace = bounds.left + bounds.width - right;
    const side = fitsRight || rightSpace >= leftSpace ? "right" : "left";
    return {
        side,
        left: clamp(side === "right" ? right : primary.left - size.width, bounds.left, bounds.left + bounds.width - size.width),
        top: clamp(rowTop, bounds.top, bounds.top + bounds.height - size.height),
    };
}
