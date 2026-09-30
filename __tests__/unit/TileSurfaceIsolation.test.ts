import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTileSurfaceController, emptyTileSurfaceModel } from '../../src/services/tileSurfaceController';
import { wallSurfaceApi } from '../../src/services/apiWallSurfaces';
import type { SurfaceActionAck, SurfaceEvent } from '../../src/services/surfaceProtocol';
import { createWallGeometry } from '../../src/services/wallGeometry';
import { endpoint, layout, surfaceState } from '../fixtures/wall/surface';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }));
afterEach(() => vi.useRealTimers());

async function setup() {
    const ids = ['form', 'dashboard'];
    const states = new Map(ids.map((id) => {
        const original = surfaceState(undefined, `${id}-view`);
        const state = { ...original, view: { ...original.view, instanceId: id }, snapshot: { ...original.snapshot, instanceId: id } };
        state.snapshot.scene.children!.push({ id: 'name', type: 'input', props: { value: '' }, events: { input: 'edit' } });
        return [id, state];
    }));
    const pending = new Map<string, SurfaceEvent>();
    const wall = { ...layout, placements: ids.map((id, index) => ({ ...layout.placements[0],
        placementId: id, source: { kind: 'surface' as const, id }, rect: { x: index * 400, y: 0, width: 400, height: 600 } })) };
    let model = emptyTileSurfaceModel(), sequence = 0;
    const service = { ...wallSurfaceApi,
        open: vi.fn(async (_device, _binding, id: string) => states.get(id)!),
        state: vi.fn(async (_device, view) => states.get(view.instanceId)!), close: vi.fn(async () => {}),
        event: vi.fn(async (_device, view, _anchor, sequence, event: SurfaceEvent) => {
            const state = states.get(view.instanceId)!;
            expect(pending.has(view.instanceId)).toBe(false);
            const editing = event.event === 'input';
            const ack: SurfaceActionAck = { protocolVersion: 'loom.surface.v1', instanceId: view.instanceId,
                eventId: event.eventId, requestId: event.eventId, accepted: true, status: editing ? 'running' : 'succeeded' };
            if (editing) pending.set(view.instanceId, event);
            states.set(view.instanceId, { ...state, sequence, pending: editing ? [{ ack, actionId: 'edit', cancelable: false }] : [] });
            return ack;
        }),
    } satisfies typeof wallSurfaceApi;
    const controller = createTileSurfaceController((next) => { model = next; }, vi.fn(), service);
    controller.prepare('current', wall, endpoint, 'lease', createWallGeometry(wall, endpoint, 'tile').projections());
    await vi.advanceTimersByTimeAsync(100);
    controller.presented(wall, endpoint, 'lease', 2);
    return {
        controller, service, pending,
        send(id: string, edit = false) {
            const layer = model.layers.find((layer) => layer.placement.source.id === id)!;
            const state = states.get(id)!;
            const anchor = controller.activate(layer, { x: id === 'form' ? 100 : 500, y: 100 });
            return controller.send(layer, anchor, { protocolVersion: 'loom.surface.v1', instanceId: id,
                attachmentId: state.view.attachmentId, eventId: `event-${++sequence}`, generation: 0,
                baseRevision: state.snapshot.revision, nodeId: edit ? 'name' : 'button', event: edit ? 'input' : 'click',
                action: edit ? 'edit' : 'add', class: edit ? 'continuous' : 'discrete', payload: edit ? { value: id } : {} });
        },
        finish(id: string, failed = false) {
            expect(pending.has(id)).toBe(true);
            const state = states.get(id)!, event = pending.get(id)!;
            pending.delete(id);
            states.set(id, { ...state, pending: [], snapshot: { ...state.snapshot, revision: state.snapshot.revision + 1 },
                failure: failed ? { requestId: event.eventId, code: 'wall_surface_action_failed' } : null });
        },
    };
}

describe('independent tile Art input', () => {
    it('serializes native submissions and drops unsent work when frozen', async () => {
        const host = await setup();
        let complete!: () => void;
        host.service.event.mockImplementationOnce(async (_device, view, _anchor, _sequence, event) =>
            new Promise<SurfaceActionAck>((resolve) => {
                complete = () => resolve({ protocolVersion: 'loom.surface.v1', instanceId: view.instanceId,
                    eventId: event.eventId, requestId: event.eventId, accepted: true, status: 'running' });
            }));
        try {
            const first = host.send('form'), second = host.send('dashboard');
            await vi.advanceTimersByTimeAsync(150);
            expect(host.service.event).toHaveBeenCalledOnce();
            host.controller.hold(); complete();
            await vi.advanceTimersByTimeAsync(100);
            await Promise.all([first, second]);
            expect(host.service.event).toHaveBeenCalledOnce();
        } finally { host.controller.clear(); }
    });

    it('delivers a dashboard click while a different form is still executing', async () => {
        const host = await setup();
        try {
            host.send('form', true);
            await vi.advanceTimersByTimeAsync(100);
            const click = host.send('dashboard');
            await vi.advanceTimersByTimeAsync(2000);
            expect(host.service.event.mock.calls.map((call) => call[1].instanceId)).toEqual(['form', 'dashboard']);
            await click;
            expect(host.pending.has('form')).toBe(true);
        } finally { host.controller.clear(); }
    });

    it('discards only the failed form dependency and preserves another Art queue', async () => {
        const host = await setup();
        try {
            host.send('form', true); host.send('dashboard', true);
            await vi.advanceTimersByTimeAsync(150);
            expect([...host.pending.keys()].sort()).toEqual(['dashboard', 'form']);
            const formClick = host.send('form'), dashboardClick = host.send('dashboard');
            host.finish('form', true);
            await vi.advanceTimersByTimeAsync(200);
            await formClick;
            host.finish('dashboard');
            await vi.advanceTimersByTimeAsync(200);
            await dashboardClick;
            expect(host.service.event.mock.calls.map((call) => [call[1].instanceId, call[4].event])).toEqual([
                ['form', 'input'], ['dashboard', 'input'], ['dashboard', 'click'],
            ]);
        } finally { host.controller.clear(); }
    });
});
