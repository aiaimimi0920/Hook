import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTileImageRenderer } from '../../src/services/tileImageRenderer';
import { wallLiveApi } from '../../src/services/apiWallLive';
import { endpoint, layout } from '../fixtures/wall/surface';
import type { WallLayout } from '../../src/services/wallTypes';

vi.mock('../../src/services/apiWallLive', () => ({ wallLiveApi: { open: vi.fn(), read: vi.fn(), close: vi.fn() } }));
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 17));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function fixture() {
    const context = { setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '',
        save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
    const reason = vi.fn(), unavailable = vi.fn();
    const renderer = createTileImageRenderer(() => canvas, reason, unavailable);
    const liveLayout: WallLayout = { ...layout, placements: [{ ...layout.placements[0], source: { kind: 'live', id: 'live-1' } }] };
    const bitmap = { width: 800, height: 600, source: canvas, close: vi.fn(),
        media: { epoch: 1n, frameId: 1n, width: 800, height: 600, receivedAtMs: 2, sentAtMs: 3,
            captureAtMs: 1, encodeAtMs: 1, droppedFrames: 0, byteLength: 1920080, format: 'raw_bgra' as const } };
    vi.mocked(wallLiveApi.open).mockResolvedValue('stream');
    vi.mocked(wallLiveApi.read).mockResolvedValue(bitmap);
    vi.mocked(wallLiveApi.close).mockResolvedValue(undefined);
    return { renderer, context, liveLayout, bitmap, unavailable, reason };
}

describe('tile display control composition', () => {
    it('retains a complete frame while closing live decode, then resumes only through a new mapping', async () => {
        const { renderer, context, liveLayout, bitmap, unavailable } = fixture();
        expect((await renderer.apply(liveLayout, endpoint, 'lease')).appliedRevision).toBeNull(); await flush();
        expect((await renderer.apply(liveLayout, endpoint, 'lease')).appliedRevision).toBe(2);
        const paints = context.drawImage.mock.calls.length, clears = context.clearRect.mock.calls.length;
        const frozen = { wallId: 'wall', revision: 3, mode: 'frozen' as const };
        expect(await renderer.apply(liveLayout, endpoint, 'lease', frozen)).toEqual({ appliedRevision: 2, presentation: { revision: 3, outcome: 'applied' } });
        await vi.advanceTimersByTimeAsync(10_000);
        expect(context.drawImage).toHaveBeenCalledTimes(paints); expect(context.clearRect).toHaveBeenCalledTimes(clears);
        expect(wallLiveApi.close).toHaveBeenCalledWith('stream'); expect(bitmap.close).toHaveBeenCalledOnce();
        expect(unavailable).toHaveBeenCalled(); expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
        expect((await renderer.apply(liveLayout, endpoint, 'lease', frozen)).presentation?.outcome).toBe('applied');
        const resumed = { ...liveLayout, revision: 4 };
        await renderer.apply(resumed, endpoint, 'lease'); await flush();
        expect((await renderer.apply(resumed, endpoint, 'lease')).appliedRevision).toBe(4);
        expect(wallLiveApi.open).toHaveBeenCalledTimes(2); expect(context.drawImage.mock.calls.length).toBeGreaterThan(paints);
        renderer.clear('done');
    });

    it('black applies without loading content and cannot be misreported as a retained frozen frame', async () => {
        const { renderer, liveLayout, reason } = fixture();
        expect(await renderer.apply(liveLayout, endpoint, 'lease', { wallId: 'wall', revision: 3, mode: 'black' }))
            .toEqual({ appliedRevision: null, presentation: { revision: 3, outcome: 'applied' } });
        expect(wallLiveApi.open).not.toHaveBeenCalled();
        expect(await renderer.apply(liveLayout, endpoint, 'lease', { wallId: 'wall', revision: 4, mode: 'frozen' }))
            .toEqual({ appliedRevision: null, presentation: { revision: 4, outcome: 'frame_unavailable' } });
        expect(reason).toHaveBeenLastCalledWith('tile_frozen_frame_unavailable');
        renderer.clear('done');
    });

    it('never freezes pixels belonging to an old lease or different layout revision', async () => {
        const { renderer, liveLayout, context } = fixture();
        await renderer.apply(liveLayout, endpoint, 'lease'); await flush(); await renderer.apply(liveLayout, endpoint, 'lease');
        const clears = context.clearRect.mock.calls.length;
        const result = await renderer.apply({ ...liveLayout, revision: 4 }, endpoint, 'lease', { wallId: 'wall', revision: 3, mode: 'frozen' });
        expect(result.presentation?.outcome).toBe('frame_unavailable'); expect(context.clearRect.mock.calls.length).toBeGreaterThan(clears);
        expect((await renderer.apply(liveLayout, endpoint, 'other-lease', { wallId: 'wall', revision: 3, mode: 'frozen' })).presentation?.outcome).toBe('frame_unavailable');
        renderer.clear('done');
    });
});
