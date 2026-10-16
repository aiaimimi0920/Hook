/** Versioned display projection and input inversion share one immutable geometry snapshot. */
import { parseTileEndpoint, parseWallLayout } from './wallProtocol';
import type {
    TileEndpoint, TilePixelPoint, TileRotation, WallHit, WallLayout,
    WallPlacement, WallPoint, WallProjection, WallRect,
} from './wallTypes';

function rotate(u: number, v: number, rotation: TileRotation): WallPoint {
    switch (rotation) {
        case 'deg0': return { x: u, y: v };
        case 'deg90': return { x: 1 - v, y: u };
        case 'deg180': return { x: 1 - u, y: 1 - v };
        case 'deg270': return { x: v, y: 1 - u };
    }
}

function contains(rect: WallRect, point: WallPoint): boolean {
    return Number.isFinite(point.x) && Number.isFinite(point.y)
        && point.x >= rect.x && point.x < rect.x + rect.width
        && point.y >= rect.y && point.y < rect.y + rect.height;
}

function sourcePoint(placement: WallPlacement, point: WallPoint): WallPoint {
    return {
        x: placement.sourceCrop.x + (point.x - placement.rect.x) / placement.rect.width * placement.sourceCrop.width,
        y: placement.sourceCrop.y + (point.y - placement.rect.y) / placement.rect.height * placement.sourceCrop.height,
    };
}

function paintOrder(a: WallPlacement, b: WallPlacement): number {
    // IDs are ASCII; localeCompare would disagree with Rust byte ordering.
    return a.zIndex - b.zIndex || (a.placementId < b.placementId ? -1 : a.placementId > b.placementId ? 1 : 0);
}

function intersection(a: WallRect, b: WallRect): WallRect | null {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const width = Math.min(a.x + a.width, b.x + b.width) - x;
    const height = Math.min(a.y + a.height, b.y + b.height) - y;
    return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function createWallGeometry(layoutValue: WallLayout, endpointValue: TileEndpoint, tileId: string) {
    // Parse copies and freezes caller-owned objects; in-flight input cannot
    // silently switch coordinate systems when the UI edits its next draft.
    const layout = parseWallLayout(layoutValue);
    const endpoint = parseTileEndpoint(endpointValue);
    const tile = layout.tiles.find((candidate) => candidate.tileId === tileId);
    if (!tile) throw new Error('Invalid wall contract: tile not found');
    if (tile.endpointId !== endpoint.endpointId) throw new Error('Invalid wall contract: endpoint mismatch');
    const { rect, rotation } = tile;
    const size = endpoint.pixelSize;
    const placements = [...layout.placements].sort(paintOrder);

    function pixelToWall(pixel: TilePixelPoint): WallPoint {
        if (!Number.isInteger(pixel.x) || !Number.isInteger(pixel.y)
            || pixel.x < 0 || pixel.y < 0 || pixel.x >= size.width || pixel.y >= size.height) {
            throw new Error('Invalid wall contract: pixel outside endpoint');
        }
        const point = rotate((pixel.x + 0.5) / size.width, (pixel.y + 0.5) / size.height, rotation);
        return { x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height };
    }

    function wallToNative(point: WallPoint): WallPoint {
        const inverse = { deg0: 'deg0', deg90: 'deg270', deg180: 'deg180', deg270: 'deg90' } as const;
        return rotate((point.x - rect.x) / rect.width, (point.y - rect.y) / rect.height, inverse[rotation]);
    }

    function wallToPixel(point: WallPoint): TilePixelPoint | null {
        if (!contains(rect, point)) return null;
        const native = wallToNative(point);
        return {
            x: Math.min(size.width - 1, Math.max(0, Math.floor(native.x * size.width))),
            y: Math.min(size.height - 1, Math.max(0, Math.floor(native.y * size.height))),
        };
    }

    function hitTest(revision: number, pixel: TilePixelPoint): WallHit | null {
        if (revision !== layout.revision) throw new Error('Invalid wall contract: stale layout revision');
        const point = pixelToWall(pixel);
        const placement = placements.findLast((candidate) => contains(candidate.rect, point));
        if (!placement?.interactive) return null;
        return { placementId: placement.placementId, source: placement.source, sourcePoint: sourcePoint(placement, point) };
    }

    function projections(): WallProjection[] {
        return placements.flatMap((placement) => {
            const visible = intersection(rect, placement.rect);
            if (!visible) return [];
            const start = { x: visible.x, y: visible.y };
            const end = { x: visible.x + visible.width, y: visible.y + visible.height };
            const sourceStart = sourcePoint(placement, start);
            const sourceEnd = sourcePoint(placement, end);
            return [{
                placementId: placement.placementId, visibleWallRect: visible,
                sourceCrop: {
                    x: sourceStart.x, y: sourceStart.y,
                    width: sourceEnd.x - sourceStart.x, height: sourceEnd.y - sourceStart.y,
                },
                outputQuad: [wallToNative(start), wallToNative({ x: end.x, y: start.y }),
                    wallToNative(end), wallToNative({ x: start.x, y: end.y })],
            }];
        });
    }

    return Object.freeze({ pixelToWall, wallToPixel, hitTest, projections });
}
