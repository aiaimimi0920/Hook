import type { StickerPoint } from "../types/stickerEditing";

type ArrowHeadOptions = {
    headLength?: number;
    headWidth?: number;
    minDistance?: number;
};

const getArrowHeadAnchorSegmentInfo = (
    points: StickerPoint[],
    minDistance = 6,
): { from: StickerPoint; to: StickerPoint; fromIndex: number; toIndex: number } | null => {
    if (points.length < 2) return null;

    const toIndex = points.length - 1;
    const to = points[points.length - 1];
    for (let index = points.length - 2; index >= 0; index -= 1) {
        const from = points[index];
        if (Math.hypot(to.x - from.x, to.y - from.y) >= minDistance) {
            return { from, to, fromIndex: index, toIndex };
        }
    }

    for (let index = points.length - 2; index >= 0; index -= 1) {
        const from = points[index];
        if (from.x !== to.x || from.y !== to.y) {
            return { from, to, fromIndex: index, toIndex };
        }
    }

    return null;
};

/** Last non-degenerate segment used to orient an arrow head. */
export const getArrowHeadAnchorSegment = (
    points: StickerPoint[],
    minDistance = 6,
): { from: StickerPoint; to: StickerPoint } | null => {
    const segment = getArrowHeadAnchorSegmentInfo(points, minDistance);
    return segment ? { from: segment.from, to: segment.to } : null;
};

const getArrowHeadGeometry = (points: StickerPoint[], options?: ArrowHeadOptions) => {
    const segment = getArrowHeadAnchorSegmentInfo(points, options?.minDistance ?? 6);
    if (!segment) return null;

    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength === 0) return null;

    const headLength = Math.min(options?.headLength ?? 12, segmentLength);
    const headWidth = options?.headWidth ?? 8;
    const angle = Math.atan2(dy, dx);
    const baseX = segment.to.x - Math.cos(angle) * headLength;
    const baseY = segment.to.y - Math.sin(angle) * headLength;
    const normalX = -Math.sin(angle);
    const normalY = Math.cos(angle);
    const halfWidth = headWidth / 2;

    return {
        ...segment,
        base: { x: baseX, y: baseY },
        leftBase: { x: baseX + normalX * halfWidth, y: baseY + normalY * halfWidth },
        rightBase: { x: baseX - normalX * halfWidth, y: baseY - normalY * halfWidth },
    };
};

export const buildArrowHeadPolygon = (points: StickerPoint[], options?: ArrowHeadOptions) => {
    const geometry = getArrowHeadGeometry(points, options);
    if (!geometry) return null;

    return [
        { x: geometry.to.x, y: geometry.to.y },
        geometry.leftBase,
        geometry.rightBase,
    ];
};

/** Returns the visible shaft with its final point shortened to the arrow-head base. */
export const getArrowShaftPoints = (points: StickerPoint[], options?: ArrowHeadOptions) => {
    const geometry = getArrowHeadGeometry(points, options);
    if (!geometry) {
        return points.map((point) => ({ ...point }));
    }

    const shaftPoints = points
        .slice(0, geometry.fromIndex + 1)
        .map((point) => ({ ...point }));
    const last = shaftPoints[shaftPoints.length - 1];
    if (!last || last.x !== geometry.base.x || last.y !== geometry.base.y) {
        shaftPoints.push(geometry.base);
    }
    return shaftPoints;
};
