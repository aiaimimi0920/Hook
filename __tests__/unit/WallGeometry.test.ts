import { describe, expect, it } from 'vitest';
import fixtureText from '../fixtures/wall/wall-geometry.v1.json?raw';
import { createWallGeometry } from '../../src/services/wallGeometry';
import { parseTileEndpoint, parseWallLayout } from '../../src/services/wallProtocol';
import type { TileEndpoint, TileRotation, WallLayout, WallPoint, WallRect } from '../../src/services/wallTypes';

interface Fixture {
    layout: WallLayout;
    endpoints: TileEndpoint[];
    cases: { tileId: string; pixel: WallPoint; wall: WallPoint; source: WallPoint }[];
    projections: { tileId: string; sourceCrop: WallRect; outputQuad: WallPoint[] }[];
}

// Mirrored public protocol fixture; the Hook checkout must also test standalone.
const fixture = (): Fixture => JSON.parse(fixtureText) as Fixture;

function geometry(data: Fixture, tileId: string) {
    const tile = data.layout.tiles.find((entry) => entry.tileId === tileId)!;
    const endpoint = data.endpoints.find((entry) => entry.endpointId === tile.endpointId)!;
    return createWallGeometry(data.layout, endpoint, tileId);
}

function pointEqual(actual: WallPoint, expected: WallPoint) {
    expect(actual.x).toBeCloseTo(expected.x, 10);
    expect(actual.y).toBeCloseTo(expected.y, 10);
}

describe('wall geometry public contract', () => {
    it('matches the language-neutral source, pixel and projection examples', () => {
        const data = fixture();
        for (const sample of data.cases) {
            const view = geometry(data, sample.tileId);
            const wall = view.pixelToWall(sample.pixel);
            pointEqual(wall, sample.wall);
            expect(view.wallToPixel(wall)).toEqual(sample.pixel);
            const hit = view.hitTest(data.layout.revision, sample.pixel)!;
            expect(hit.placementId).toBe('application');
            expect(hit.source).toEqual({ kind: 'live', id: 'live-1' });
            pointEqual(hit.sourcePoint, sample.source);
        }
        for (const sample of data.projections) {
            const projections = geometry(data, sample.tileId).projections();
            expect(projections).toHaveLength(1);
            const actual = projections[0];
            pointEqual(actual.sourceCrop, sample.sourceCrop);
            expect(actual.sourceCrop.width).toBeCloseTo(sample.sourceCrop.width, 10);
            expect(actual.sourceCrop.height).toBeCloseTo(sample.sourceCrop.height, 10);
            actual.outputQuad.forEach((point, index) => pointEqual(point, sample.outputQuad[index]));
        }
    });

    it.each<TileRotation>(['deg0', 'deg90', 'deg180', 'deg270'])('round trips edge pixels at %s', (rotation) => {
        const data = fixture();
        data.layout = { ...data.layout, tiles: data.layout.tiles.map((tile) => ({ ...tile, rotation })) };
        const view = geometry(data, 'right');
        for (const x of [0, 1, 49, 50, 98, 99]) {
            for (const y of [0, 1, 99, 100, 198, 199]) {
                const pixel = { x, y };
                expect(view.wallToPixel(view.pixelToWall(pixel))).toEqual(pixel);
            }
        }
    });

    it('assigns the seam to one tile and rejects stale, fractional and outside pixels', () => {
        const data = fixture();
        const left = geometry(data, 'left');
        const right = geometry(data, 'right');
        expect(left.wallToPixel({ x: 0, y: 0 })).toBeNull();
        expect(right.wallToPixel({ x: 0, y: 0 })).not.toBeNull();
        expect(left.wallToPixel({ x: NaN, y: 0 })).toBeNull();
        expect(() => left.hitTest(6, { x: 0, y: 0 })).toThrow('stale');
        for (const x of [-1, 0.5, 100, Infinity, NaN]) {
            expect(() => left.pixelToWall({ x, y: 0 })).toThrow('pixel outside');
        }
        expect(() => createWallGeometry(data.layout, data.endpoints[1], 'left')).toThrow('endpoint mismatch');
    });

    it('uses the same paint and hit order and blocks clicks through noninteractive foregrounds', () => {
        const data = fixture();
        const foreground = {
            ...data.layout.placements[0], placementId: 'foreground',
            source: { kind: 'surface' as const, id: 'surface-1' },
        };
        data.layout = { ...data.layout, placements: [...data.layout.placements, foreground] };
        const before = geometry(data, 'left');
        const pixel = { x: 50, y: 50 };
        expect(before.projections().at(-1)?.placementId).toBe('foreground');
        expect(before.hitTest(7, pixel)?.placementId).toBe('foreground');
        foreground.interactive = false;
        expect(geometry(data, 'left').hitTest(7, pixel)).toBeNull();
        // Mutating the next layout draft cannot change an already accepted snapshot.
        expect(before.hitTest(7, pixel)?.placementId).toBe('foreground');
        foreground.rect = { ...foreground.rect, x: 500 };
        const after = geometry(data, 'left');
        expect(after.projections()).toHaveLength(1);
        expect(after.hitTest(7, pixel)?.placementId).toBe('application');
    });

    it('keeps multiple placements of one source independent without mutating source identity', () => {
        const data = fixture();
        const source = data.layout.placements[0];
        data.layout = { ...data.layout, placements: [source, {
            ...source, placementId: 'second', zIndex: 1,
            rect: { x: -100, y: -50, width: 50, height: 50 },
        }] };
        const view = geometry(data, 'left');
        expect(view.projections().map((p) => p.placementId)).toEqual(['application', 'second']);
        expect(view.hitTest(7, { x: 0, y: 0 })?.placementId).toBe('second');
        expect(view.hitTest(7, { x: 99, y: 99 })?.placementId).toBe('application');
        expect(view.hitTest(7, { x: 0, y: 0 })?.source).toEqual(source.source);
    });
});

describe('wall wire validation', () => {
    it('rejects invalid, unbounded and conflicting geometry', () => {
        const { layout } = fixture();
        const invalid: unknown[] = [
            ...[0, -1, NaN, Infinity, 1e-300, 1_000_001].map((width) => ({ ...layout, bounds: { ...layout.bounds, width } })),
            { ...layout, revision: Number.MAX_SAFE_INTEGER + 1 },
            { ...layout, revision: 1.5 },
            { ...layout, protocolVersion: 'loom.wall.v0' },
            { ...layout, tiles: [layout.tiles[0], { ...layout.tiles[1], rect: { ...layout.tiles[1].rect, x: -1 } }] },
            { ...layout, tiles: [layout.tiles[0], { ...layout.tiles[1], endpointId: layout.tiles[0].endpointId }] },
            { ...layout, placements: [...layout.placements, layout.placements[0]] },
            { ...layout, placements: [{ ...layout.placements[0], sourceCrop: { x: 0.5, y: 0, width: 1, height: 1 } }] },
            { ...layout, tiles: Array.from({ length: 65 }, () => layout.tiles[0]) },
            { ...layout, placements: Array.from({ length: 257 }, () => layout.placements[0]) },
        ];
        for (const value of invalid) expect(() => parseWallLayout(value)).toThrow('Invalid wall contract');
    });

    it('rejects extra fields at every object boundary and invalid resource references', () => {
        const { layout } = fixture();
        const tile = layout.tiles[0];
        const placement = layout.placements[0];
        const invalid = [
            { ...layout, unknown: true },
            { ...layout, bounds: { ...layout.bounds, unknown: true } },
            { ...layout, tiles: [{ ...tile, unknown: true }] },
            { ...layout, tiles: [{ ...tile, rotation: 'deg45' }] },
            { ...layout, placements: [{ ...placement, unknown: true }] },
            { ...layout, placements: [{ ...placement, source: { ...placement.source, unknown: true } }] },
            { ...layout, placements: [{ ...placement, source: { kind: 'image', id: 'file:///private.png' }, interactive: false }] },
            { ...layout, placements: [{ ...placement, source: { kind: 'image', id: `sha256:${'a'.repeat(64)}` } }] },
        ];
        for (const value of invalid) expect(() => parseWallLayout(value)).toThrow('Invalid wall contract');
        const image = { ...placement, source: { kind: 'image', id: `sha256:${'a'.repeat(64)}` }, interactive: false };
        expect(() => parseWallLayout({ ...layout, placements: [image] })).not.toThrow();
    });

    it('bounds endpoint capabilities while allowing display-only endpoints', () => {
        const endpoint = fixture().endpoints[0];
        expect(parseTileEndpoint({ ...endpoint, inputCapabilities: [] }).inputCapabilities).toEqual([]);
        for (const value of [
            { ...endpoint, renderModes: [] },
            { ...endpoint, renderModes: ['raw_bgra', 'raw_bgra'] },
            { ...endpoint, renderModes: ['unknown'] },
            { ...endpoint, inputCapabilities: ['pointer', 'pointer'] },
            { ...endpoint, pixelSize: { width: 16_385, height: 100 } },
            { ...endpoint, endpointId: 'x'.repeat(161) },
            { ...endpoint, pixelSize: { ...endpoint.pixelSize, unknown: true } },
        ]) expect(() => parseTileEndpoint(value)).toThrow('Invalid wall contract');
    });
});
