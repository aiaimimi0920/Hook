/** One bounded reliable queue per endpoint; only adjacent pointer moves may be replaced. */
import { wallInputApi, type WallInputBinding, type WallInputEvent } from './apiWallInput';
import { createWallGeometry } from './wallGeometry';
import { tileFailure } from './tilePresenter';
import type { TileEndpoint, TilePixelPoint, WallLayout } from './wallTypes';

interface Context { deviceId: string; binding: WallInputBinding; layout: WallLayout; endpoint: TileEndpoint }
interface Owner { context: Context; controlId: string; placementId: string; sequence: number; pointerId: number; expires: number }
type Pending = { event: WallInputEvent; born: number };

export function createTileInputController(notice: (message: string) => void, api = wallInputApi) {
    let context: Context | undefined;
    let owner: Owner | undefined;
    let generation = 0;
    let running: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let queue: Pending[] = [];
    let renewing = false;
    let disposed = false;
    let releaseNeeded = false;

    async function release() {
        const previous = owner; owner = undefined; releaseNeeded = false;
        if (previous) {
            try { await api.release(previous.context.deviceId, { binding: previous.context.binding, controlId: previous.controlId }); }
            catch { /* The server's short, non-persisted controller lease bounds ambiguous completion. */ }
        }
    }
    function cancel(message = '') {
        generation++; queue = []; renewing = false; releaseNeeded = true;
        clearTimeout(timer); timer = undefined; notice(message); pump();
    }
    function target(current: Context, pixel: TilePixelPoint) {
        const tile = current.layout.tiles.find((t) => t.endpointId === current.endpoint.endpointId);
        if (!tile) return undefined;
        const hit = createWallGeometry(current.layout, current.endpoint, tile.tileId).hitTest(current.layout.revision, pixel);
        return hit?.source.kind === 'live' ? hit : undefined;
    }
    function scheduleRenewal() {
        clearTimeout(timer);
        if (owner && !disposed) timer = setTimeout(() => { timer = undefined; renewing = true; pump(); }, 1000);
    }
    async function drain() {
        while (releaseNeeded || renewing || queue.length) {
            if (releaseNeeded) { await release(); continue; }
            if (renewing) {
                renewing = false;
                if (owner) {
                    const current = owner, version = generation;
                    await api.renew(current.context.deviceId, { binding: current.context.binding, controlId: current.controlId });
                    if (version === generation && owner === current) { current.expires = performance.now() + 3000; scheduleRenewal(); }
                }
                continue;
            }
            const pending = queue.shift()!;
            if (!context || disposed) continue;
            // Do not replay queued clicks after a slow network call, even if the lease survived.
            if (performance.now() - pending.born > 1500) { cancel('wall_input_late'); continue; }
            const current = context, version = generation, event = pending.event;
            const pixel = event.kind === 'key' ? undefined : event.pixel;
            const hit = pixel ? target(current, pixel) : undefined;
            if (pixel && !hit) { cancel('wall_input_no_target'); continue; }
            const canAcquire = event.kind === 'wheel' || (event.kind === 'button' && event.state === 'pressed');
            if (owner && hit && owner.placementId !== hit.placementId) {
                if (!canAcquire) { cancel('wall_input_target_changed'); continue; }
                await release();
                if (version !== generation) continue;
            }
            if (!owner) {
                if (!canAcquire || !pixel || !hit) continue;
                const pointerId = event.kind === 'button' ? event.pointerId : 0;
                const granted = await api.acquire(current.deviceId, current.binding, pixel, pointerId);
                owner = { context: current, controlId: granted.controlId, placementId: granted.placementId,
                    pointerId, sequence: 0, expires: performance.now() + Math.min(3000, granted.leaseTtlMs - 500) };
                if (version !== generation || disposed) { await release(); continue; }
                scheduleRenewal(); notice(`正在操作 · ${granted.placementId} · 移出内容或切换焦点可交接`);
            }
            if (performance.now() >= owner.expires || performance.now() - pending.born > 1500) {
                cancel('wall_input_late'); continue;
            }
            // Wheel-only focus has no physical pointer. A later pointer starts a fresh owner.
            if ((event.kind === 'button' || event.kind === 'move') && owner.pointerId !== event.pointerId) {
                if (canAcquire) { await release(); queue.unshift(pending); continue; }
                cancel('wall_pointer_changed'); continue;
            }
            await api.send(current.deviceId, { binding: current.binding, controlId: owner.controlId }, ++owner.sequence, event);
        }
    }
    function pump() {
        if (running) return;
        // Establish ownership before drain can synchronously cancel and re-enter pump.
        running = Promise.resolve().then(drain).catch((error: unknown) => {
            const code = tileFailure(error);
            cancel(code === 'wall_control_conflict' ? '其他终端正在操作此来源；请先释放，或在来源端收回操作权。' : code);
        }).finally(() => {
            running = undefined;
            if (releaseNeeded || queue.length || renewing) pump();
        });
    }
    return {
        update(layout: WallLayout | null, endpoint: TileEndpoint, leaseId: string, applied: number | null) {
            const next = layout && applied === layout.revision
                ? { deviceId: endpoint.deviceId, endpoint, layout, binding: { endpointId: endpoint.endpointId, leaseId, revision: layout.revision } } : undefined;
            if (JSON.stringify(next?.binding) !== JSON.stringify(context?.binding)) cancel();
            context = next;
        },
        send(event: WallInputEvent) {
            if (!context || disposed) return;
            const last = queue.at(-1);
            if (event.kind === 'move' && last?.event.kind === 'move') queue[queue.length - 1] = { event, born: performance.now() };
            else if (queue.length >= 64) { cancel('wall_input_queue_full'); return; }
            else queue.push({ event, born: performance.now() });
            pump();
        },
        cancel,
        clear(message = '') { context = undefined; cancel(message); },
        async stop() { disposed = true; context = undefined; cancel(); while (running) await running; },
    };
}
