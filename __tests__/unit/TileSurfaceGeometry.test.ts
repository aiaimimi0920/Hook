import { describe, expect, it } from 'vitest';
import { createWallGeometry } from '../../src/services/wallGeometry';
import { tileMediaClips, tileSurfaceLayers, tileSurfaceMatrix } from '../../src/services/tileSurfaceGeometry';
import type { TileRotation, WallLayout, WallRect } from '../../src/services/wallTypes';
import { endpoint, layout } from '../fixtures/wall/surface';

const contains = (r: WallRect, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
describe('Art crop, rotation and interleaved media composition', () => {
    it.each<TileRotation>(['deg0', 'deg90', 'deg180', 'deg270'])('maps source content and input to the same output pixels at %s', (rotation) => {
        const wall: WallLayout = { ...layout, tiles: [{ ...layout.tiles[0], rotation }],
            placements: [{ ...layout.placements[0], sourceCrop: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 } }] };
        const geometry = createWallGeometry(wall, endpoint, 'tile');
        const [a, b, c, d, e, f] = tileSurfaceMatrix(geometry.projections()[0], 640, 480, 800, 600);
        for (const pixel of [{ x: 0, y: 0 }, { x: 799, y: 599 }, { x: 322, y: 247 }]) {
            const source = geometry.hitTest(2, pixel)!.sourcePoint;
            expect(a * source.x * 640 + c * source.y * 480 + e).toBeCloseTo(pixel.x + 0.5, 7);
            expect(b * source.x * 640 + d * source.y * 480 + f).toBeCloseTo(pixel.y + 0.5, 7);
        }
    });

    it('keeps transparent foreground media above lower Art but behind a higher Art', () => {
        const art = layout.placements[0];
        const wall: WallLayout = { ...layout, placements: [art,
            { ...art, placementId: 'media', zIndex: 1, source: { kind: 'live', id: 'video' }, rect: { x: 200, y: 0, width: 400, height: 600 } },
            { ...art, placementId: 'top', zIndex: 2, rect: { x: 400, y: 0, width: 400, height: 300 } }] };
        const projections = createWallGeometry(wall, endpoint, 'tile').projections();
        const layers = tileSurfaceLayers(projections, wall.placements), overlay = tileMediaClips(projections, wall.placements).get('media')!;
        expect(layers[0].clips.some((r) => contains(r, 0.3, 0.3))).toBe(true);
        expect(layers[0].inputClips.some((r) => contains(r, 0.3, 0.3))).toBe(false);
        expect(overlay.some((r) => contains(r, 0.3, 0.3))).toBe(true);
        expect(overlay.some((r) => contains(r, 0.6, 0.3))).toBe(false);
        expect(overlay.some((r) => contains(r, 0.6, 0.8))).toBe(true);
    });
});
