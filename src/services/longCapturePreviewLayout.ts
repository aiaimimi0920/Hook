import type { CaptureRect } from "./captureState";

/** Keep the preview outside the capture; an excluded overlay can use an inset fallback. */
export function longCapturePreviewLayout(
    rect: CaptureRect, viewport: { width: number; height: number }, overlayExcluded = false,
) {
    const gap = 12;
    const right = viewport.width - rect.x - rect.w - gap * 2;
    const left = rect.x - gap * 2;
    const available = right >= 80 ? right : left;
    if (available < 80 && !overlayExcluded) return null;
    const width = Math.max(1, Math.min(240, available >= 80 ? available : viewport.width - gap * 2));
    const height = Math.max(1, Math.min(640, viewport.height - gap * 2));
    const x = right >= 80 ? rect.x + rect.w + gap
        : left >= 80 ? rect.x - gap - width : viewport.width - width - gap;
    const y = Math.max(gap, Math.min(rect.y, viewport.height - height - gap));
    return { x, y, width, height };
}
