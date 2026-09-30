import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTileSurfaceController, emptyTileSurfaceModel } from '../../src/services/tileSurfaceController';
import { wallSurfaceApi } from '../../src/services/apiWallSurfaces';
import { createWallGeometry } from '../../src/services/wallGeometry';
import type { SurfaceActionAck, SurfaceEvent } from '../../src/services/surfaceProtocol';
import { endpoint, layout, surfaceState } from '../fixtures/wall/surface';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }));
afterEach(() => vi.useRealTimers());
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

async function setup() {
    let model = emptyTileSurfaceModel(), current = surfaceState(), running: SurfaceEvent | undefined, id = 0;
    current.snapshot.scene.children!.push(...['name', 'notes'].map((field) => ({
        id: field, type: 'input' as const, props: { value: '' }, events: { input: field, change: field },
    })));
    const service = { ...wallSurfaceApi, open: vi.fn(async () => current), state: vi.fn(async () => current),
        close: vi.fn(async () => {}), event: vi.fn(async (_device, _view, _anchor, sequence, event: SurfaceEvent) => {
            expect(running).toBeUndefined();
            running = event;
            const ack: SurfaceActionAck = { protocolVersion: 'loom.surface.v1', instanceId: 'instance',
                eventId: event.eventId, requestId: `request-${event.eventId}`, accepted: true, status: 'running' };
            current = { ...current, sequence, pending: [{ ack, actionId: event.action!, cancelable: false }] };
            return ack;
        }) } satisfies typeof wallSurfaceApi;
    const controller = createTileSurfaceController((next) => { model = next; }, vi.fn(), service);
    controller.prepare('current', layout, endpoint, 'lease', createWallGeometry(layout, endpoint, 'tile').projections());
    await flush();
    controller.presented(layout, endpoint, 'lease', 2);
    const layer = model.layers[0], anchor = controller.activate(layer, { x: 100, y: 100 });
    return {
        controller, service, model: () => model,
        send(nodeId: string, value?: string, kind: 'input' | 'change' | 'click' = 'input') {
            return controller.send(layer, anchor, { protocolVersion: 'loom.surface.v1', instanceId: 'instance',
                attachmentId: 'attachment', eventId: `event-${++id}`, nodeId, event: kind,
                action: nodeId === 'button' ? 'add' : nodeId, class: kind === 'input' ? 'continuous' : kind === 'change' ? 'commit' : 'discrete',
                generation: 0, baseRevision: model.states.get('instance')!.snapshot.revision,
                payload: value === undefined ? {} : { value } });
        },
        finish(failed = false) {
            expect(running).toBeDefined();
            const event = running!;
            current = failed ? { ...current, pending: [], failure: { requestId: `request-${event.eventId}`, code: 'wall_surface_action_failed' } }
                : { ...current, pending: [], snapshot: { ...current.snapshot, revision: current.snapshot.revision + 1,
                scene: { ...current.snapshot.scene, children: current.snapshot.scene.children!.map((node) =>
                    node.id === event.nodeId ? { ...node, props: event.payload } : node) } } };
            running = undefined;
        },
    };
}

describe('tile Art input waiting behind real execution', () => {
    it('retains the newest text and a cross-field change while an earlier action takes over five seconds', async () => {
        const host = await setup();
        try {
            const first = host.send('name', 'C');
            await vi.advanceTimersByTimeAsync(100);
            const coalesced = host.send('name', 'Co');
            const latest = host.send('name', 'Continuous keyboard 0123456789');
            const blur = host.send('name', 'Continuous keyboard 0123456789', 'change');
            let settled = false;
            const notes = host.send('notes', 'Rapid cross-field notes', 'change')?.then(() => { settled = true; });
            await vi.advanceTimersByTimeAsync(6500);
            expect(host.service.event).toHaveBeenCalledOnce();
            expect(settled).toBe(false);
            expect(host.model().editing).toBe(true);
            host.finish();
            for (let calls = 2; calls <= 4; calls++) {
                await vi.advanceTimersByTimeAsync(200);
                expect(host.service.event).toHaveBeenCalledTimes(calls);
                host.finish();
            }
            await vi.advanceTimersByTimeAsync(200);
            await Promise.all([first, coalesced, latest, blur, notes]);
            expect(host.service.event.mock.calls.map((call) => [call[4].nodeId, call[4].payload, call[4].baseRevision])).toEqual([
                ['name', { value: 'C' }, 1],
                ['name', { value: 'Continuous keyboard 0123456789' }, 2],
                ['name', { value: 'Continuous keyboard 0123456789' }, 3],
                ['notes', { value: 'Rapid cross-field notes' }, 4],
            ]);
            expect(settled).toBe(true);
            expect(host.model().editing).toBe(false);
        } finally { host.controller.clear(); }
    });

    it('waits for preceding field edits before delivering a dependent form action', async () => {
        const host = await setup();
        try {
            host.send('name', 'C');
            await vi.advanceTimersByTimeAsync(100);
            const click = host.send('button', undefined, 'click');
            await vi.advanceTimersByTimeAsync(6500);
            expect(host.service.event).toHaveBeenCalledOnce();
            host.finish();
            await vi.advanceTimersByTimeAsync(200);
            await click;
            expect(host.service.event).toHaveBeenCalledTimes(2);
            expect(host.service.event.mock.calls[1][4]).toMatchObject({ nodeId: 'button', baseRevision: 2 });
        } finally { host.controller.clear(); }
    });

    it('still expires an independent click behind running non-edit work and reports the discard', async () => {
        const host = await setup();
        try {
            host.send('button', undefined, 'click');
            await vi.advanceTimersByTimeAsync(100);
            const click = host.send('button', undefined, 'click');
            await vi.advanceTimersByTimeAsync(2000);
            host.finish();
            await vi.advanceTimersByTimeAsync(200);
            await click;
            expect(host.service.event).toHaveBeenCalledOnce();
            expect(host.model().notice).toBe('wall_surface_event_expired');
        } finally { host.controller.clear(); }
    });

    it('discards a dependent form action when its preceding edit fails', async () => {
        const host = await setup();
        try {
            host.send('name', 'C');
            await vi.advanceTimersByTimeAsync(100);
            const click = host.send('button', undefined, 'click');
            host.finish(true);
            await vi.advanceTimersByTimeAsync(200);
            await click;
            expect(host.service.event).toHaveBeenCalledOnce();
            expect(host.model().notice).toBe('wall_surface_action_failed');
            expect(host.model().states.get('instance')?.snapshot.revision).toBe(1);
        } finally { host.controller.clear(); }
    });

    it('bounds waiting drafts without replaying an already accepted mutation', async () => {
        const host = await setup();
        try {
            const first = host.send('name', 'C');
            await vi.advanceTimersByTimeAsync(100);
            const queued = host.send('notes', 'unsent', 'change');
            const click = host.send('button', undefined, 'click');
            await vi.advanceTimersByTimeAsync(31_000);
            await Promise.all([first, queued, click]);
            expect(host.service.event).toHaveBeenCalledOnce();
            expect(host.model().notice).toBe('wall_surface_action_pending');
        } finally { host.controller.clear(); }
    });
});
