/** Tile-owned Art state and ordered host actions; ordinary Hook workspace state is never initialized. */
import { wallSurfaceApi, type WallSurfaceAnchor } from './apiWallSurfaces';
import { createTileSurfaceCache, type TileSurfaceState } from './tileSurfaceCache';
import { createTileSurfaceImages } from './tileSurfaceImages';
import { tileMediaClips, tileSurfaceLayers, tileSurfaceMatrix, type TileSurfaceLayer } from './tileSurfaceGeometry';
import { createWallGeometry } from './wallGeometry';
import { tileFailure } from './tilePresenter';
import { sameSurfaceView, type WallSurfaceView } from './wallSurfaceProtocol';
import type { SurfaceActionAck, SurfaceConfirmationRequest, SurfaceEvent } from './surfaceProtocol';
import type { TileEndpoint, TilePixelPoint, WallLayout, WallProjection, WallRect } from './wallTypes';
import { isTileSurfaceValueEdit, refreshTileSurfaceEvent } from './tileSurfaceEvent';

const VALUE_WAIT_MS = 30_000, ACTION_WAIT_MS = 1500;

export interface TileSurfaceConfirmation { request: SurfaceConfirmationRequest; view: WallSurfaceView; anchor: WallSurfaceAnchor }
export interface TileSurfaceModel {
    layers: readonly TileSurfaceLayer[];
    states: ReadonlyMap<string, TileSurfaceState>;
    mediaClips: ReadonlyMap<string, readonly WallRect[]>;
    active: boolean;
    editing: boolean;
    confirmation?: TileSurfaceConfirmation;
    submitting: boolean;
    notice: string;
    version: number;
}
export const emptyTileSurfaceModel = (): TileSurfaceModel => ({ layers: [], states: new Map(), mediaClips: new Map(), active: false, editing: false, submitting: false, notice: '', version: 0 });

export function createTileSurfaceController(changed: (model: TileSurfaceModel) => void, releaseLive: () => void, api = wallSurfaceApi) {
    const cache = createTileSurfaceCache(refresh, api), images = createTileSurfaceImages(refresh, api);
    let context: { key: string; leaseId: string; endpoint: TileEndpoint; layout: WallLayout; geometry: ReturnType<typeof createWallGeometry> } | undefined;
    let layers: readonly TileSurfaceLayer[] = [], mediaClips: ReadonlyMap<string, readonly WallRect[]> = new Map();
    let active = false, held = false, notice = '', failure = '', version = 0, generation = 0, submitting = false;
    const sequences = new Map<string, { view: WallSurfaceView; sequence: number }>();
    const reportedFailures = new Map<string, string>();
    const anchors = new Map<string, { view: WallSurfaceView; anchor: WallSurfaceAnchor; expires: number }>();
    const queue: { state: TileSurfaceState; anchor: WallSurfaceAnchor; event: SurfaceEvent;
        valueEdit: boolean; afterEdits: boolean; expires: number; settle: () => void }[] = [];
    const running = new Set<string>(), activeEdits = new Map<string, TileSurfaceState>();
    let dispatch = Promise.resolve();
    // Serialize native submissions, not source execution; leave permits for polling, images and confirmation.
    function dispatchEvent(send: () => Promise<SurfaceActionAck | undefined>) {
        const result = dispatch.then(send);
        dispatch = result.then(() => {}, () => {});
        return result;
    }
    function discardQueue(instanceId?: string) {
        for (let index = queue.length - 1; index >= 0; index--) {
            if (instanceId === undefined || queue[index].state.view.instanceId === instanceId) queue.splice(index, 1)[0].settle();
        }
    }
    function confirmation(): TileSurfaceConfirmation | undefined {
        if (!active) return;
        for (const state of cache.states()) for (const request of state.confirmations) {
            const anchor = anchors.get(request.eventId);
            if (anchor && sameSurfaceView(anchor.view, state.view)) return { request, ...anchor };
        }
    }
    function refresh() {
        for (const [id, anchor] of anchors) if (Date.now() >= anchor.expires) anchors.delete(id);
        for (const state of cache.states()) {
            if (state.failure && reportedFailures.get(state.view.instanceId) !== state.failure.requestId) {
                reportedFailures.set(state.view.instanceId, state.failure.requestId);
                notice = state.failure.code;
            }
        }
        if (context && !held) {
            try {
                images.prepare(context.key, context.endpoint.deviceId, cache.states());
                for (const layer of layers) {
                    const state = cache.get(layer.placement.source.id);
                    if (state) tileSurfaceMatrix(layer.projection, state.width, state.height, context.endpoint.pixelSize.width, context.endpoint.pixelSize.height);
                }
                failure = '';
            } catch (error) { failure = tileFailure(error); }
        }
        changed({ layers, mediaClips, active: active && ready(), states: new Map(cache.states().map((state) => [state.view.instanceId, state])),
            editing: activeEdits.size > 0 || queue.some((item) => item.valueEdit),
            confirmation: confirmation(), submitting, notice, version: ++version });
    }
    function ready() { return Boolean(context) && !failure && cache.ready() && images.ready(); }
    function clear() {
        context = undefined; layers = []; mediaClips = new Map(); active = false; held = false; generation++;
        activeEdits.clear();
        discardQueue(); sequences.clear(); anchors.clear(); reportedFailures.clear(); notice = ''; failure = ''; submitting = false;
        images.clear(); cache.clear(); refresh();
    }
    function valid(state: TileSurfaceState, anchor: WallSurfaceAnchor): boolean {
        if (!context || held || !active || !ready()) return false;
        const current = cache.get(state.view.instanceId);
        if (!current || !sameSurfaceView(current.view, state.view) || current.generation !== state.generation) return false;
        const hit = context.geometry.hitTest(context.layout.revision, anchor.pixel);
        return hit?.placementId === anchor.placementId && hit.source.kind === 'surface' && hit.source.id === state.view.instanceId;
    }
    async function drain(instanceId: string) {
        while (true) {
            const index = queue.findIndex((item) => item.state.view.instanceId === instanceId);
            if (index < 0) return;
            const next = queue.splice(index, 1)[0], ticket = generation;
            if (!valid(next.state, next.anchor)) { next.settle(); continue; }
            if (performance.now() > next.expires) {
                if (next.valueEdit) discardQueue(instanceId);
                notice = 'wall_surface_event_expired'; next.settle(); refresh(); continue;
            }
            // A form action waits for earlier edits, then has 1.5 seconds to revalidate and submit.
            if (next.afterEdits) next.expires = Math.min(next.expires, performance.now() + ACTION_WAIT_MS);
            if (next.valueEdit) activeEdits.set(instanceId, next.state);
            const view = next.state.view;
            try {
                let current = await cache.sync(view.instanceId);
                while (current?.pending.length && ticket === generation && performance.now() <= next.expires) {
                    await new Promise<void>((resolve) => setTimeout(resolve, 50));
                    current = await cache.sync(view.instanceId);
                }
                if (ticket !== generation || !current || current.generation !== next.state.generation || !valid(current, next.anchor)) continue;
                if (performance.now() > next.expires) {
                    if (next.valueEdit) discardQueue(instanceId);
                    notice = 'wall_surface_event_expired'; refresh(); continue;
                }
                const ack = await dispatchEvent(async () => {
                    const latest = cache.get(instanceId);
                    if (ticket !== generation || !latest || latest.generation !== next.state.generation || !valid(latest, next.anchor)) return;
                    if (performance.now() > next.expires) {
                        if (next.valueEdit) discardQueue(instanceId);
                        notice = 'wall_surface_event_expired'; refresh(); return;
                    }
                    const event = refreshTileSurfaceEvent(next.event, next.state.snapshot, latest.snapshot);
                    const previous = sequences.get(instanceId);
                    const sequence = Math.max(latest.sequence, previous && sameSurfaceView(previous.view, view) ? previous.sequence : 0) + 1;
                    sequences.set(instanceId, { view, sequence });
                    return api.event(context!.endpoint.deviceId, view, next.anchor, sequence, event);
                });
                if (ticket !== generation || !ack) continue;
                if (ack.eventId !== next.event.eventId) throw new Error('wall_surface_ack_mismatch');
                notice = ack.accepted ? '' : 'wall_surface_action_rejected';
                if (!ack.accepted && next.valueEdit) discardQueue(instanceId);
                if (ack.status === 'awaiting_confirmation' && anchors.size < 64) {
                    anchors.set(next.event.eventId, { view, anchor: next.anchor, expires: Date.now() + 120_000 });
                }
                cache.refresh(view.instanceId);
                if (ack.accepted && ack.status !== 'awaiting_confirmation' && ['input', 'change'].includes(next.event.event)) {
                    // Retain the latest local draft while earlier accepted edits publish their snapshots.
                    const deadline = performance.now() + (next.valueEdit ? VALUE_WAIT_MS : ACTION_WAIT_MS);
                    current = await cache.sync(view.instanceId);
                    while (ticket === generation && current?.pending.some((item) => item.ack.requestId === ack.requestId)
                        && performance.now() < deadline) {
                        await new Promise<void>((resolve) => setTimeout(resolve, 50));
                        current = await cache.sync(view.instanceId);
                    }
                    if (ticket === generation && current?.pending.some((item) => item.ack.requestId === ack.requestId)) {
                        discardQueue(instanceId); notice = 'wall_surface_action_pending';
                    }
                    if (ticket === generation && current?.failure?.requestId === ack.requestId) discardQueue(instanceId);
                }
            } catch (error) {
                if (ticket === generation) {
                    // Input rejection does not revoke readable pixels. A failed state read still invalidates the view.
                    // The next gesture resynchronizes the server's sequence, without replaying this mutation.
                    discardQueue(instanceId); notice = tileFailure(error); sequences.delete(view.instanceId); cache.refresh(view.instanceId);
                }
            } finally { activeEdits.delete(instanceId); next.settle(); }
            refresh();
        }
    }
    function pump() {
        for (const instanceId of new Set(queue.map((item) => item.state.view.instanceId))) {
            if (running.has(instanceId)) continue;
            if (running.size >= 4) break;
            running.add(instanceId);
            void drain(instanceId).finally(() => { running.delete(instanceId); pump(); });
        }
    }
    function suspend() { active = false; activeEdits.clear(); generation++; discardQueue(); anchors.clear(); submitting = false; refresh(); }
    return {
        clear, ready, mediaClips: () => mediaClips, resource: images.get,
        hold() { if (!held) { held = true; cache.hold(); images.hold(); suspend(); } },
        reason: () => failure || cache.reason() || (!images.ready() ? images.reason() : ''),
        prepare(key: string, layout: WallLayout, endpoint: TileEndpoint, leaseId: string, projections: readonly WallProjection[]) {
            if (context?.key !== key || held) {
                clear();
                const tile = layout.tiles.find((tile) => tile.endpointId === endpoint.endpointId)!;
                layers = tileSurfaceLayers(projections, layout.placements); mediaClips = tileMediaClips(projections, layout.placements);
                context = { key, leaseId, layout, endpoint, geometry: createWallGeometry(layout, endpoint, tile.tileId) };
            }
            const ids = layers.map((layer) => layer.placement.source.id);
            cache.prepare(key, endpoint.deviceId, { endpointId: endpoint.endpointId, leaseId, revision: layout.revision }, ids);
            refresh();
        },
        presented(layout: WallLayout | null, endpoint: TileEndpoint, leaseId: string, applied: number | null) {
            active = Boolean(!held && context && layout && context.layout.revision === applied && layout.revision === applied
                && context.endpoint.endpointId === endpoint.endpointId && context.leaseId === leaseId);
            if (!active) { discardQueue(); anchors.clear(); }
            refresh();
        },
        suspend,
        activate(layer: TileSurfaceLayer, pixel: TilePixelPoint): WallSurfaceAnchor | undefined {
            releaseLive();
            const state = cache.get(layer.placement.source.id), anchor = { placementId: layer.placement.placementId, pixel };
            return state && valid(state, anchor) ? anchor : undefined;
        },
        send(layer: TileSurfaceLayer, anchor: WallSurfaceAnchor | undefined, event: SurfaceEvent) {
            const state = cache.get(layer.placement.source.id);
            if (!state || !anchor || !valid(state, anchor) || confirmation()) return;
            if (anchors.size >= 64 || JSON.stringify(event).length > 96 * 1024) { notice = 'wall_surface_event_limit'; refresh(); return; }
            let settle!: () => void;
            const result = new Promise<void>((resolve) => { settle = resolve; });
            const valueEdit = isTileSurfaceValueEdit(event, state.snapshot);
            const sameEditView = (candidate?: TileSurfaceState) => candidate !== undefined && candidate.generation === state.generation
                && sameSurfaceView(candidate.view, state.view);
            const afterEdits = !valueEdit && (sameEditView(activeEdits.get(state.view.instanceId)) || queue.some((item) => item.valueEdit && sameEditView(item.state)));
            const expires = performance.now() + (valueEdit || afterEdits ? VALUE_WAIT_MS : ACTION_WAIT_MS);
            const next = { state, anchor, event, valueEdit, afterEdits, expires, settle }, previous = queue.at(-1);
            if (event.class === 'continuous' && previous?.event.class === 'continuous' && previous.event.nodeId === event.nodeId
                && previous.state.view.attachmentId === state.view.attachmentId) { previous.settle(); queue[queue.length - 1] = next; }
            else if (queue.length < 32) queue.push(next);
            else { notice = 'wall_surface_queue_full'; refresh(); return; }
            if (afterEdits) notice = 'wall_surface_waiting_for_edits';
            refresh();
            pump(); return result;
        },
        async decide(approved: boolean) {
            const pending = confirmation();
            if (!pending || submitting || !context) return;
            const state = cache.get(pending.view.instanceId);
            if (!state || !valid(state, pending.anchor)) return;
            const ticket = generation;
            submitting = true; notice = ''; releaseLive(); refresh();
            try {
                await api.confirm(context.endpoint.deviceId, pending.view, pending.anchor, pending.request.confirmationId, approved);
                if (ticket === generation) { anchors.delete(pending.request.eventId); cache.refresh(pending.view.instanceId); }
            } catch (error) { if (ticket === generation) notice = tileFailure(error); }
            finally { if (ticket === generation) { submitting = false; refresh(); } }
        },
        async cancel(instanceId: string, requestId: string) {
            const state = cache.get(instanceId);
            if (!active || !state || !context || submitting) return;
            const ticket = generation;
            submitting = true; releaseLive(); refresh();
            try { await api.cancel(context.endpoint.deviceId, state.view, requestId); if (ticket === generation) cache.refresh(instanceId); }
            catch (error) { if (ticket === generation) notice = tileFailure(error); }
            finally { if (ticket === generation) { submitting = false; refresh(); } }
        },
    };
}
