import type { StickerPoint } from "../types/stickerEditing";
import type { ShapeBox } from "./stickerGeometryTypes";

/** Minimum sides for a non-degenerate polygon. */
export const MIN_POLYGON_SIDES = 3;
// Matches the editor control and bounds allocations from persisted/untrusted data.
const MAX_POLYGON_SIDES = 12;

/** Triangle vertices with an apex at top-center and a full-width base. */
export const buildTrianglePoints = (box: ShapeBox): StickerPoint[] => [
    { x: box.x + box.w / 2, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
];

/** Polygon vertices inscribed in the box ellipse, starting at -90 degrees. */
export const buildPolygonPoints = (box: ShapeBox, sides: number): StickerPoint[] => {
    const requestedSides = Number.isFinite(sides) ? Math.round(sides) : MIN_POLYGON_SIDES;
    const sideCount = Math.max(MIN_POLYGON_SIDES, Math.min(MAX_POLYGON_SIDES, requestedSides));
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const radiusX = box.w / 2;
    const radiusY = box.h / 2;
    return Array.from({ length: sideCount }, (_, i) => {
        const angle = (Math.PI * 2 * i) / sideCount - Math.PI / 2;
        return { x: cx + radiusX * Math.cos(angle), y: cy + radiusY * Math.sin(angle) };
    });
};

const formatPathNumber = (value: number) => {
    const rounded = Math.round(value * 1000) / 1000;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toString();
};

const normalizeVector = (dx: number, dy: number) => {
    const length = Math.hypot(dx, dy);
    if (length < 0.0001) {
        return { x: 0, y: 0, length: 0 };
    }
    return { x: dx / length, y: dy / length, length };
};

type RoundedCornerSpec = {
    corner: StickerPoint;
    entry: StickerPoint;
    exit: StickerPoint;
};

const buildRoundedCornerSpecs = (points: StickerPoint[], radius: number): RoundedCornerSpec[] => {
    if (points.length < 3) return [];

    return points.map((corner, index) => {
        const prev = points[(index - 1 + points.length) % points.length];
        const next = points[(index + 1) % points.length];
        const toPrev = normalizeVector(prev.x - corner.x, prev.y - corner.y);
        const toNext = normalizeVector(next.x - corner.x, next.y - corner.y);

        const maxOffset = Math.min(toPrev.length, toNext.length) / 2;
        const dot = Math.max(-1, Math.min(1, toPrev.x * toNext.x + toPrev.y * toNext.y));
        const angle = Math.acos(dot);
        const tangentOffset =
            angle > 0.0001 && Math.tan(angle / 2) > 0.0001
                ? radius / Math.tan(angle / 2)
                : radius;
        const offset = Math.max(0, Math.min(radius, tangentOffset, maxOffset));

        return {
            corner,
            entry: {
                x: corner.x + toPrev.x * offset,
                y: corner.y + toPrev.y * offset,
            },
            exit: {
                x: corner.x + toNext.x * offset,
                y: corner.y + toNext.y * offset,
            },
        };
    });
};

/** Builds an SVG path for a sharp or rounded closed polygon. */
export const buildRoundedPolygonPath = (points: StickerPoint[], radius = 0): string => {
    if (points.length < 3) return "";
    if (radius <= 0) {
        return `M ${points.map((point) => `${formatPathNumber(point.x)} ${formatPathNumber(point.y)}`).join(" L ")} Z`;
    }

    const corners = buildRoundedCornerSpecs(points, radius);
    if (corners.length < 3) return "";

    const commands = [
        `M ${formatPathNumber(corners[0].exit.x)} ${formatPathNumber(corners[0].exit.y)}`,
    ];

    for (let index = 1; index < corners.length; index += 1) {
        const corner = corners[index];
        commands.push(`L ${formatPathNumber(corner.entry.x)} ${formatPathNumber(corner.entry.y)}`);
        commands.push(
            `Q ${formatPathNumber(corner.corner.x)} ${formatPathNumber(corner.corner.y)} ${formatPathNumber(corner.exit.x)} ${formatPathNumber(corner.exit.y)}`,
        );
    }

    const firstCorner = corners[0];
    commands.push(`L ${formatPathNumber(firstCorner.entry.x)} ${formatPathNumber(firstCorner.entry.y)}`);
    commands.push(
        `Q ${formatPathNumber(firstCorner.corner.x)} ${formatPathNumber(firstCorner.corner.y)} ${formatPathNumber(firstCorner.exit.x)} ${formatPathNumber(firstCorner.exit.y)}`,
    );
    commands.push("Z");
    return commands.join(" ");
};

/** Traces the same rounded polygon geometry into a canvas context. */
export const traceRoundedPolygonPath = (
    context: CanvasRenderingContext2D,
    points: StickerPoint[],
    radius = 0,
) => {
    if (points.length < 3) return;

    if (radius <= 0) {
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
            context.lineTo(points[index].x, points[index].y);
        }
        context.closePath();
        return;
    }

    const corners = buildRoundedCornerSpecs(points, radius);
    if (corners.length < 3) return;

    context.beginPath();
    context.moveTo(corners[0].exit.x, corners[0].exit.y);
    for (let index = 1; index < corners.length; index += 1) {
        const corner = corners[index];
        context.lineTo(corner.entry.x, corner.entry.y);
        context.quadraticCurveTo(corner.corner.x, corner.corner.y, corner.exit.x, corner.exit.y);
    }
    context.lineTo(corners[0].entry.x, corners[0].entry.y);
    context.quadraticCurveTo(
        corners[0].corner.x,
        corners[0].corner.y,
        corners[0].exit.x,
        corners[0].exit.y,
    );
    context.closePath();
};

/** Serializes vertices for an SVG `points` attribute. */
export const toSvgPoints = (points: StickerPoint[]): string =>
    points.map((point) => `${point.x},${point.y}`).join(" ");
