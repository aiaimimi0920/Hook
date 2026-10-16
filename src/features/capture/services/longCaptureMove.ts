import type { CaptureRect } from "./captureState";

/** A small overlapping step translates the viewfinder, never the underlying application. */
export function longCaptureMoveDelta(rect: CaptureRect, horizontal: boolean, sign: number,
    viewport: { width: number; height: number }) {
    const length = horizontal ? rect.w : rect.h;
    const step = Math.min(64, Math.max(1, length / 5));
    const position = horizontal ? rect.x : rect.y;
    const limit = Math.max(0, (horizontal ? viewport.width : viewport.height) - length);
    const destination = Math.max(0, Math.min(limit, position + sign * step));
    return horizontal ? { dx: destination - position, dy: 0 } : { dx: 0, dy: destination - position };
}
