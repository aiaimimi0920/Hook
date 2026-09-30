import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTileSurfaceCache } from '../../src/services/tileSurfaceCache';
import { createTileSurfaceImages } from '../../src/services/tileSurfaceImages';
import { wallSurfaceApi, type WallSurfaceImage } from '../../src/services/apiWallSurfaces';
import type { WallSurfaceState } from '../../src/services/wallSurfaceProtocol';
import { binding, surfaceState } from '../fixtures/wall/surface';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const api = () => ({ ...wallSurfaceApi, open: vi.fn(wallSurfaceApi.open), state: vi.fn(wallSurfaceApi.state),
    close: vi.fn(async () => {}), image: vi.fn(wallSurfaceApi.image) });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('tile Surface connection and resource ownership', () => {
    it('holds the admitted snapshot and owned view while discarding a late poll and settling input waiters', async () => {
        const service = api(), cache = createTileSurfaceCache(vi.fn(), service);
        const initial = surfaceState(), updated = surfaceState(); updated.snapshot.revision = 2;
        let finish!: (state: WallSurfaceState) => void;
        service.open.mockResolvedValue(initial);
        service.state.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        cache.prepare('key', 'device', binding, ['instance']); await flush();
        await vi.advanceTimersByTimeAsync(400);
        const pending = cache.sync('instance');
        cache.hold(); finish(updated); await flush();
        expect(await pending).toBeUndefined();
        expect(cache.get('instance')?.snapshot).toBe(initial.snapshot);
        expect(service.close).not.toHaveBeenCalled();
        cache.refresh('instance'); await vi.advanceTimersByTimeAsync(10_000);
        expect(service.state).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
        cache.clear(); expect(service.close).toHaveBeenCalledOnce();
    });

    it('retains admitted image URLs during a hold and closes an in-flight image instead of publishing it', async () => {
        const service = api(), images = createTileSurfaceImages(vi.fn(), service), state = surfaceState();
        const firstId = `sha256:${'a'.repeat(64)}`, secondId = `sha256:${'b'.repeat(64)}`;
        state.snapshot.resources = [firstId, secondId].map((resourceId) => ({ resourceId, kind: 'image', mime: 'image/png', size: 1 }));
        state.snapshot.scene.children = [firstId, secondId].map((resourceId) => ({ id: resourceId, type: 'image', props: { resourceId } }));
        const admitted = { url: 'blob:admitted', pixels: 4, close: vi.fn() }, late = { url: 'blob:late', pixels: 4, close: vi.fn() };
        let finish!: (value: WallSurfaceImage) => void;
        service.image.mockResolvedValueOnce(admitted).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        images.prepare('key', 'device', [state]); await flush();
        const admittedId = service.image.mock.calls[0][2], pendingId = service.image.mock.calls[1][2];
        images.hold(); finish(late); await flush(); await vi.advanceTimersByTimeAsync(10_000);
        expect(images.get(admittedId)).toBe('blob:admitted'); expect(admitted.close).not.toHaveBeenCalled();
        expect(images.get(pendingId)).toBeUndefined(); expect(late.close).toHaveBeenCalledOnce();
        expect(service.image).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
        images.clear(); expect(admitted.close).toHaveBeenCalledOnce();
    });

    it('does not satisfy an input refresh with a poll that began before the request', async () => {
        const service = api(), cache = createTileSurfaceCache(vi.fn(), service);
        const initial = surfaceState(), updated = surfaceState(); updated.snapshot.revision = 2;
        let finish!: (state: WallSurfaceState) => void;
        service.open.mockResolvedValue(initial);
        service.state.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(updated);
        cache.prepare('key', 'device', binding, ['instance']); await flush();
        await vi.advanceTimersByTimeAsync(400);
        let completed = false;
        const fresh = cache.sync('instance').then((state) => { completed = true; return state; });
        finish({ ...initial, snapshot: null }); await flush();
        expect(completed).toBe(false);
        await vi.advanceTimersByTimeAsync(40);
        expect((await fresh)?.snapshot.revision).toBe(2);
        expect(service.state).toHaveBeenCalledTimes(2); cache.clear();
    });

    it('deduplicates placements, closes a late grant, and serializes replacement opens', async () => {
        const service = api(), cache = createTileSurfaceCache(vi.fn(), service);
        let resolve!: (state: WallSurfaceState) => void;
        service.open.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
        cache.prepare('old', 'device', binding, ['instance', 'instance']);
        const nextBinding = { ...binding, revision: 3 };
        cache.prepare('new', 'device', nextBinding, ['instance']);
        service.open.mockResolvedValue(surfaceState(nextBinding, 'replacement'));
        expect(service.open).toHaveBeenCalledTimes(1);
        resolve(surfaceState()); await flush();
        expect(service.close).toHaveBeenCalledWith('device', surfaceState().view);
        expect(cache.get('instance')).toBeUndefined();
        await vi.advanceTimersByTimeAsync(40);
        expect(cache.get('instance')?.view.attachmentId).toBe('replacement');
        cache.clear(); expect(service.close).toHaveBeenCalledWith('device', surfaceState(nextBinding, 'replacement').view);
        await vi.advanceTimersByTimeAsync(2000); expect(service.open).toHaveBeenCalledTimes(2);
    });

    it('does not replace a mounted scene on unchanged polls and rejects a regressing formal revision', async () => {
        const service = api(), cache = createTileSurfaceCache(vi.fn(), service);
        const initial = surfaceState();
        Object.assign(initial, { result: { protocolVersion: 'loom.surface.v1', instanceId: 'instance', requestId: 'request', generation: 0,
            resultRevision: 3, outputs: { output: { kind: 'value', value: 'formal' } } } });
        service.open.mockResolvedValue(initial); service.state.mockResolvedValue({ ...initial, snapshot: null });
        cache.prepare('key', 'device', binding, ['instance']); await flush();
        const snapshot = cache.get('instance')!.snapshot;
        await vi.advanceTimersByTimeAsync(400);
        expect(cache.get('instance')!.snapshot).toBe(snapshot);
        service.state.mockResolvedValue({ ...initial, snapshot: null, result: null });
        await vi.advanceTimersByTimeAsync(400);
        expect(cache.ready()).toBe(false); expect(cache.reason()).toBe('wall_surface_stale_state');
        expect(service.close).toHaveBeenCalledOnce(); cache.clear();
    });

    it('bounds Art sources and shared image pixels, and revokes late image URLs after clear', async () => {
        const service = api(), cache = createTileSurfaceCache(vi.fn(), service);
        expect(() => cache.prepare('key', 'device', binding, ['a', 'b', 'c', 'd', 'e'])).toThrow('source_limit');
        expect(service.open).not.toHaveBeenCalled();
        const images = createTileSurfaceImages(vi.fn(), service), state = surfaceState();
        const resourceId = `sha256:${'a'.repeat(64)}`;
        state.snapshot.resources = [{ resourceId, kind: 'image', mime: 'image/png', size: 1 }];
        state.snapshot.scene = { id: 'image', type: 'image', props: { resourceId } };
        let resolve!: (image: WallSurfaceImage) => void;
        service.image.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
        images.prepare('key', 'device', [state, state]);
        expect(service.image).toHaveBeenCalledOnce(); images.clear();
        const late = { url: 'blob:late', pixels: 4, close: vi.fn() }; resolve(late); await flush();
        expect(late.close).toHaveBeenCalledOnce(); expect(images.get(resourceId)).toBeUndefined();
        const huge = { url: 'blob:large', pixels: 16_777_217, close: vi.fn() };
        service.image.mockResolvedValue(huge); images.prepare('new', 'device', [state]); await flush();
        expect(huge.close).toHaveBeenCalledOnce(); expect(images.reason()).toBe('tile_surface_image_pixel_limit');
        images.clear(); cache.clear();
    });
});
