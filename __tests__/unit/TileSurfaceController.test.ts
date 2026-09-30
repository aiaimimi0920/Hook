import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTileSurfaceController, emptyTileSurfaceModel, type TileSurfaceModel } from '../../src/services/tileSurfaceController';
import { wallSurfaceApi } from '../../src/services/apiWallSurfaces';
import { createWallGeometry } from '../../src/services/wallGeometry';
import type { SurfaceActionAck, SurfaceEvent } from '../../src/services/surfaceProtocol';
import { binding, endpoint, layout, surfaceState } from '../fixtures/wall/surface';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const event: SurfaceEvent = { protocolVersion: 'loom.surface.v1', instanceId: 'instance', attachmentId: 'attachment',
    eventId: 'event', nodeId: 'button', event: 'click', action: 'add', class: 'discrete', generation: 0, baseRevision: 1, payload: {} };
const ack: SurfaceActionAck = { protocolVersion: 'loom.surface.v1', instanceId: 'instance', eventId: 'event', requestId: 'request', accepted: true, status: 'awaiting_confirmation' };

describe('tile host action ownership', () => {
    it('freezing drops queued input and late confirmations without cancelling already accepted source work', async () => {
        let model = emptyTileSurfaceModel(), finish!: (value: SurfaceActionAck) => void;
        const state = surfaceState();
        const service = { ...wallSurfaceApi, open: vi.fn(async () => state), state: vi.fn(async () => ({ ...state, snapshot: null })),
            close: vi.fn(async () => {}), event: vi.fn(() => new Promise<SurfaceActionAck>((resolve) => { finish = resolve; })),
            cancel: vi.fn(wallSurfaceApi.cancel) };
        const controller = createTileSurfaceController((next) => { model = next; }, vi.fn(), service);
        controller.prepare('current', layout, endpoint, 'lease', createWallGeometry(layout, endpoint, 'tile').projections()); await flush();
        controller.presented(layout, endpoint, 'lease', 2);
        const layer = model.layers[0], anchor = controller.activate(layer, { x: 100, y: 100 });
        const admitted = controller.send(layer, anchor, event); await flush();
        const queued = controller.send(layer, anchor, { ...event, eventId: 'queued' });
        controller.hold(); await queued;
        controller.presented(layout, endpoint, 'lease', 2);
        expect(model.active).toBe(false); expect(controller.activate(layer, { x: 100, y: 100 })).toBeUndefined();
        finish(ack); await admitted; await vi.advanceTimersByTimeAsync(3000);
        expect(service.event).toHaveBeenCalledOnce(); expect(service.cancel).not.toHaveBeenCalled();
        expect(service.close).not.toHaveBeenCalled(); expect(model.confirmation).toBeUndefined();
        expect(model.states.get('instance')?.snapshot).toBe(state.snapshot);
        controller.clear(); expect(service.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    });

    it('settles a text edit only after a fresh read observes its execution outcome', async () => {
        let model = emptyTileSurfaceModel(), current = surfaceState(), settled = false;
        current.snapshot.scene.children = [{ id: 'field', type: 'input', props: { value: '' }, events: { input: 'edit' } }];
        const edited: SurfaceEvent = { ...event, nodeId: 'field', event: 'input', action: 'edit', class: 'continuous', payload: { value: 'new' } };
        const accepted = { ...ack, status: 'running' as const };
        const service = { ...wallSurfaceApi, open: vi.fn(async () => current), state: vi.fn(async () => current), close: vi.fn(async () => {}),
            event: vi.fn(async () => {
                current = { ...current, sequence: 1, pending: [{ ack: accepted, actionId: 'edit', cancelable: true }] };
                return accepted;
            }) };
        const controller = createTileSurfaceController((next) => { model = next; }, vi.fn(), service);
        controller.prepare('current', layout, endpoint, 'lease', createWallGeometry(layout, endpoint, 'tile').projections()); await flush();
        controller.presented(layout, endpoint, 'lease', 2);
        const layer = model.layers[0], anchor = controller.activate(layer, { x: 100, y: 100 });
        const completion = controller.send(layer, anchor, edited)?.then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(200);
        expect(service.event).toHaveBeenCalledOnce(); expect(settled).toBe(false);
        current = { ...current, pending: [], snapshot: { ...current.snapshot, revision: 2,
            scene: { ...current.snapshot.scene, children: [{ ...current.snapshot.scene.children![0], props: { value: 'new' } }] } } };
        await vi.advanceTimersByTimeAsync(200); await completion;
        expect(settled).toBe(true); expect(model.states.get('instance')?.snapshot.revision).toBe(2);
        controller.clear();
    });

    it('refreshes the input revision after an asynchronous patch but rejects a replaced control action', async () => {
        let model = emptyTileSurfaceModel();
        const initial = surfaceState(), updated = surfaceState();
        updated.snapshot.revision = 2;
        const service = { ...wallSurfaceApi, open: vi.fn(async () => initial), state: vi.fn(async () => updated), close: vi.fn(async () => {}),
            event: vi.fn(async () => ({ ...ack, status: 'succeeded' as const })) };
        const controller = createTileSurfaceController((next) => { model = next; }, vi.fn(), service);
        controller.prepare('current', layout, endpoint, 'lease', createWallGeometry(layout, endpoint, 'tile').projections()); await flush();
        controller.presented(layout, endpoint, 'lease', 2);
        const layer = model.layers[0], anchor = controller.activate(layer, { x: 100, y: 100 });
        controller.send(layer, anchor, event); await flush();
        expect(service.event).toHaveBeenCalledWith('device', initial.view, anchor, 1, { ...event, baseRevision: 2 });
        const changed = surfaceState(); changed.snapshot.revision = 3;
        changed.snapshot.scene.children![0].events = { click: 'different-action' };
        service.state.mockResolvedValue(changed);
        controller.send(layer, anchor, { ...event, eventId: 'second', baseRevision: 2 });
        await vi.advanceTimersByTimeAsync(100); await flush();
        expect(service.event).toHaveBeenCalledOnce();
        expect(model.notice).toBe('wall_surface_event_changed');
        controller.clear();
    });

    it('reports asynchronous execution failure without discarding the last scene', async () => {
        let model = emptyTileSurfaceModel();
        const state = surfaceState();
        const service = { ...wallSurfaceApi, open: vi.fn(async () => state), state: vi.fn(async () => ({ ...state, snapshot: null })),
            close: vi.fn(async () => {}) };
        const controller = createTileSurfaceController((next) => { model = next; }, vi.fn(), service);
        controller.prepare('current', layout, endpoint, 'lease', createWallGeometry(layout, endpoint, 'tile').projections()); await flush();
        controller.presented(layout, endpoint, 'lease', 2);
        Object.assign(state, { failure: { requestId: 'failed-request', code: 'wall_surface_action_failed' } });
        await vi.advanceTimersByTimeAsync(500);
        expect(model.notice).toBe('wall_surface_action_failed');
        expect(model.active).toBe(true);
        expect(model.states.get('instance')?.snapshot.authoritativeState).toEqual({ count: 7 });
        controller.clear();
    });

    it('admits events only after applied acknowledgement and preserves a host-owned confirmation anchor', async () => {
        let model: TileSurfaceModel = emptyTileSurfaceModel();
        const state = surfaceState();
        const service = { ...wallSurfaceApi, open: vi.fn(async () => state), state: vi.fn(async () => ({ ...state, snapshot: null })),
            close: vi.fn(async () => {}), event: vi.fn(async () => ack), confirm: vi.fn(async () => ({ ...ack, status: 'cancelled' as const })) };
        const releaseLive = vi.fn();
        const controller = createTileSurfaceController((next) => { model = next; }, releaseLive, service);
        const projections = createWallGeometry(layout, endpoint, 'tile').projections();
        controller.prepare('tile:lease:wall:2:800:600', layout, endpoint, 'lease', projections); await flush();
        const layer = model.layers[0];
        expect(controller.activate(layer, { x: 100, y: 100 })).toBeUndefined();
        controller.presented(layout, endpoint, 'lease', 2);
        const anchor = controller.activate(layer, { x: 100, y: 100 });
        controller.send(layer, anchor, event); await flush();
        expect(service.event).toHaveBeenCalledWith('device', state.view, anchor, 1, event);
        Object.assign(state, { confirmations: [{ protocolVersion: 'loom.surface.v1', confirmationId: 'confirmation', instanceId: 'instance',
            attachmentId: 'attachment', deviceId: 'device', hookNodeId: 'tile', eventId: 'event', requestId: 'request', actionId: 'add', risk: 'high', expiresAtMs: Date.now() + 30000 }] });
        await vi.advanceTimersByTimeAsync(500);
        expect(model.confirmation?.request.confirmationId).toBe('confirmation');
        controller.send(layer, anchor, { ...event, eventId: 'second' }); await flush();
        expect(service.event).toHaveBeenCalledOnce();
        await controller.decide(false);
        expect(service.confirm).toHaveBeenCalledWith('device', state.view, anchor, 'confirmation', false);
        expect(model.confirmation).toBeUndefined(); expect(releaseLive).toHaveBeenCalled();
        controller.clear();
    });

    it('discards queued actions on layout replacement and does not show late confirmations on the successor', async () => {
        let model = emptyTileSurfaceModel(), finish!: (ack: SurfaceActionAck) => void;
        const service = { ...wallSurfaceApi, open: vi.fn(async (_device, current) => surfaceState(current)),
            state: vi.fn(async () => surfaceState()), close: vi.fn(async () => {}),
            event: vi.fn(() => new Promise<SurfaceActionAck>((resolve) => { finish = resolve; })) } satisfies typeof wallSurfaceApi;
        const controller = createTileSurfaceController((next) => { model = next; }, vi.fn(), service);
        controller.prepare('old', layout, endpoint, 'lease', createWallGeometry(layout, endpoint, 'tile').projections()); await flush();
        controller.presented(layout, endpoint, 'lease', 2);
        const layer = model.layers[0], anchor = controller.activate(layer, { x: 100, y: 100 });
        controller.send(layer, anchor, event);
        await flush();
        controller.send(layer, anchor, { ...event, eventId: 'queued' });
        const nextLayout = { ...layout, revision: 3 };
        controller.prepare('new', nextLayout, endpoint, 'lease', createWallGeometry(nextLayout, endpoint, 'tile').projections());
        finish(ack); await flush();
        expect(service.event).toHaveBeenCalledOnce(); expect(model.confirmation).toBeUndefined();
        expect(service.close).toHaveBeenCalledWith('device', surfaceState(binding).view);
        controller.clear();
    });
});
