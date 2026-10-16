interface Frame { x: number; y: number; w: number; h: number }

/** Prefer touching the left edge; only sacrifice top alignment to stay on screen. */
export const placeStickerSettings = (frame: Frame, viewport: { w: number; h: number }, panel: { w: number; h: number }) => {
    const w = Math.min(panel.w, Math.max(0, viewport.w));
    const h = Math.min(panel.h, Math.max(0, viewport.h));
    const fitsRight = frame.x + frame.w + w <= viewport.w;
    const fitsLeft = frame.x >= w;
    let x = fitsLeft ? frame.x - w : fitsRight ? frame.x + frame.w : frame.x;
    let y = frame.y;
    if (!fitsRight && !fitsLeft) y = frame.y + frame.h + h <= viewport.h ? frame.y + frame.h : frame.y - h;
    x = Math.max(0, Math.min(x, viewport.w - w));
    y = Math.max(0, Math.min(y, viewport.h - h));
    return { x, y, w, h };
};
