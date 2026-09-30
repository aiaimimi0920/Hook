import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTileImageRenderer } from '../../src/services/tileImageRenderer';
import { createTileSurfaceController, emptyTileSurfaceModel } from '../../src/services/tileSurfaceController';
import { wallSurfaceApi } from '../../src/services/apiWallSurfaces';
import type { SurfaceActionAck, SurfaceEvent } from '../../src/services/surfaceProtocol';
import { endpoint, layout, surfaceState } from '../fixtures/wall/surface';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function setup() {
    let model = emptyTileSurfaceModel(), frame!: FrameRequestCallback, reject!: (error: unknown) => void;
    const state = surfaceState();
    const service = { ...wallSurfaceApi, open: vi.fn(async () => state), state: vi.fn(async () => state),
        close: vi.fn(async () => {}), event: vi.fn<typeof wallSurfaceApi.event>(() => new Promise<SurfaceActionAck>((_resolve, fail) => { reject = fail; })) };
    const surfaces = createTileSurfaceController((next) => { model = next; }, vi.fn(), service);
    const context = { setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
    const canvas = { width: 800, height: 600, getContext: () => context } as unknown as HTMLCanvasElement;
    const media = { ...canvas };
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const renderer = createTileImageRenderer(() => canvas, vi.fn(), () => surfaces.suspend(), surfaces, () => media);
    await renderer.apply(layout, endpoint, 'lease'); await flush();
    expect((await renderer.apply(layout, endpoint, 'lease')).appliedRevision).toBe(layout.revision);
    surfaces.presented(layout, endpoint, 'lease', layout.revision);
    const layer = model.layers[0], anchor = surfaces.activate(layer, { x: 100, y: 100 });
    const event: SurfaceEvent = { protocolVersion: 'loom.surface.v1', instanceId: 'instance', attachmentId: 'attachment',
        eventId: 'late-change', nodeId: 'button', event: 'click', action: 'add', class: 'discrete', generation: 0, baseRevision: 1, payload: {} };
    const pending = surfaces.send(layer, anchor, event);
    await vi.advanceTimersByTimeAsync(50);
    expect(service.event).toHaveBeenCalledOnce();
    const queued = surfaces.send(layer, anchor, { ...event, eventId: 'queued' });
    return { renderer, surfaces, service, context, state, model: () => model, paint: () => frame(0),
        send: (eventId: string) => surfaces.send(layer, anchor, { ...event, eventId }),
        fail: async () => { reject({ code: 'wall_request_rejected', status: 409 }); await Promise.all([pending, queued]); },
        freeze: () => renderer.apply(layout, endpoint, 'lease', { wallId: layout.wallId, revision: 3, mode: 'frozen' }) };
}

describe('Art input rejection before a display control is observed', () => {
    it('keeps the complete authorized frame when a late input is rejected before freeze', async () => {
        const host = await setup();
        try {
            const clears = host.context.clearRect.mock.calls.length;
            await host.fail(); host.paint();
            expect(await host.freeze()).toEqual({ appliedRevision: layout.revision, presentation: { revision: 3, outcome: 'applied' } });
            expect(host.context.clearRect).toHaveBeenCalledTimes(clears);
            expect(host.model().states.get('instance')?.snapshot).toBe(host.state.snapshot);
            expect(host.model().active).toBe(false);
            await vi.advanceTimersByTimeAsync(3000);
            expect(host.service.event).toHaveBeenCalledOnce();
            expect(host.service.open).toHaveBeenCalledOnce();
            expect(host.service.close).not.toHaveBeenCalled();
        } finally { host.renderer.clear('done'); }
        expect(host.service.close).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('still clears a retained scene when the subsequent read loses authorization', async () => {
        const host = await setup();
        try {
            host.service.state.mockRejectedValue({ code: 'wall_request_rejected', status: 403 });
            await host.fail(); await vi.advanceTimersByTimeAsync(100); host.paint();
            expect(host.surfaces.ready()).toBe(false);
            expect(host.model().states.size).toBe(0);
            expect((await host.freeze()).presentation?.outcome).toBe('frame_unavailable');
            expect(host.service.event).toHaveBeenCalledOnce();
            expect(host.service.close).toHaveBeenCalledOnce();
        } finally { host.renderer.clear('done'); }
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([0, 1])('uses the freshly observed sequence %i for the next gesture without replaying the failed one', async (sequence) => {
        const host = await setup();
        try {
            await host.fail();
            host.service.state.mockResolvedValue({ ...host.state, sequence });
            host.service.event.mockResolvedValue({ protocolVersion: 'loom.surface.v1', instanceId: 'instance',
                eventId: 'next-gesture', requestId: 'next-request', accepted: true, status: 'succeeded' });
            const next = host.send('next-gesture');
            await vi.advanceTimersByTimeAsync(100); await next;
            expect(host.service.event.mock.calls.map((call) => [call[3], call[4].eventId]))
                .toEqual([[1, 'late-change'], [sequence + 1, 'next-gesture']]);
            expect(host.service.close).not.toHaveBeenCalled();
            expect(host.service.open).toHaveBeenCalledOnce();
        } finally { host.renderer.clear('done'); }
    });
});
