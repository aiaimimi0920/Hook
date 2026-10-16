/** Two media planes preserve alpha and Art stacking without allocating a canvas per placement. */
import type { WallPlacement, WallPoint, WallProjection, WallRect } from './wallTypes';

export interface TileSurfaceLayer { readonly placement: WallPlacement; readonly projection: WallProjection; readonly clips: readonly WallRect[]; readonly inputClips: readonly WallRect[] }

function bounds(points: readonly WallPoint[]): WallRect {
    const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
function subtract(a: WallRect, b: WallRect): WallRect[] {
    const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
    if (right <= left || bottom <= top) return [a];
    return [
        { x: a.x, y: a.y, width: a.width, height: top - a.y },
        { x: a.x, y: bottom, width: a.width, height: a.y + a.height - bottom },
        { x: a.x, y: top, width: left - a.x, height: bottom - top },
        { x: right, y: top, width: a.x + a.width - right, height: bottom - top },
    ].filter((rect) => rect.width > 0 && rect.height > 0);
}
export function tileSurfaceLayers(projections: readonly WallProjection[], placements: readonly WallPlacement[]): TileSurfaceLayer[] {
    const layers: TileSurfaceLayer[] = [];
    let rectangles = 0;
    for (let index = 0; index < projections.length; index++) {
        const projection = projections[index], placement = placements.find((p) => p.placementId === projection.placementId)!;
        if (placement.source.kind !== 'surface') continue;
        let clips = [bounds(projection.outputQuad)], inputClips = [...clips];
        for (const higher of projections.slice(index + 1)) {
            const area = bounds(higher.outputQuad);
            inputClips = inputClips.flatMap((rect) => subtract(rect, area));
            if (placements.find((p) => p.placementId === higher.placementId)?.source.kind === 'surface') {
                clips = clips.flatMap((rect) => subtract(rect, area));
            }
            if (clips.length > 256 || inputClips.length > 256) throw new Error('tile_surface_clip_limit');
        }
        if (!clips.length) continue;
        rectangles += clips.length;
        if (rectangles > 1024 || layers.length >= 16) throw new Error('tile_surface_layer_limit');
        layers.push({ placement, projection, clips, inputClips });
    }
    return layers;
}

export function tileMediaClips(projections: readonly WallProjection[], placements: readonly WallPlacement[]): ReadonlyMap<string, readonly WallRect[]> {
    const result = new Map<string, WallRect[]>();
    const arts = projections.filter((p) => placements.find((item) => item.placementId === p.placementId)?.source.kind === 'surface');
    let rectangles = 0;
    projections.forEach((projection, index) => {
        if (arts.includes(projection)) return;
        let clips = arts.filter((art) => projections.indexOf(art) < index).map((art) => bounds(art.outputQuad));
        for (const higher of arts.filter((art) => projections.indexOf(art) > index)) {
            clips = clips.flatMap((rect) => subtract(rect, bounds(higher.outputQuad)));
            if (clips.length > 256) throw new Error('tile_surface_clip_limit');
        }
        // Clipping uses one nonzero path, so overlapping rectangles never double-blend alpha.
        const own = bounds(projection.outputQuad);
        clips = clips.map((rect) => {
            const x = Math.max(rect.x, own.x), y = Math.max(rect.y, own.y);
            return { x, y, width: Math.min(rect.x + rect.width, own.x + own.width) - x,
                height: Math.min(rect.y + rect.height, own.y + own.height) - y };
        }).filter((rect) => rect.width > 0 && rect.height > 0);
        rectangles += clips.length;
        if (rectangles > 4096) throw new Error('tile_surface_clip_limit');
        if (clips.length) result.set(projection.placementId, clips);
    });
    return result;
}

export function tileSurfaceMatrix(projection: WallProjection, sourceWidth: number, sourceHeight: number, outputWidth: number, outputHeight: number): readonly number[] {
    const [p, x, , y] = projection.outputQuad, crop = projection.sourceCrop;
    const a = (x.x - p.x) * outputWidth / crop.width, b = (x.y - p.y) * outputHeight / crop.width;
    const c = (y.x - p.x) * outputWidth / crop.height, d = (y.y - p.y) * outputHeight / crop.height;
    if (Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) > 65_536) throw new Error('tile_surface_scale_limit');
    return [a / sourceWidth, b / sourceWidth, c / sourceHeight, d / sourceHeight,
        p.x * outputWidth - a * crop.x - c * crop.y, p.y * outputHeight - b * crop.x - d * crop.y];
}
