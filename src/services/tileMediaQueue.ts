/** Common daemon receive time selects frames; this is software scheduling, not display synchronization. */
import type { WallLiveFrame } from './apiWallLive';
import type { TileClock } from './tileClock';

export const TILE_MEDIA_DELAY_MS = 80;
const MAX_PENDING = 3, MAX_LATE_MS = 250, MAX_HOLD_MS = 1000;
export function createTileMediaQueue(clock?: Pick<TileClock, 'estimate'>) {
    let pending: WallLiveFrame[] = [], current: WallLiveFrame | undefined;
    let epoch = 0n, frameId = 0n, receivedAt = 0;
    let receivedFrames = 0, receivedBytes = 0, selectedFrames = 0, repeatedSelections = 0;
    let skippedFrames = 0, lateFrames = 0, staleFrames = 0;
    let selectedAtMs: number | null = null, clockUncertaintyMs: number | null = null;
    const add = (value: number, count = 1) => Math.min(Number.MAX_SAFE_INTEGER, value + count);
    function clear() {
        current?.close(); current = undefined;
        pending.forEach((frame) => frame.close()); pending = [];
        selectedAtMs = null; clockUncertaintyMs = null;
    }
    function push(frame: WallLiveFrame) {
        const media = frame.media;
        receivedFrames = add(receivedFrames); receivedBytes = add(receivedBytes, media.byteLength);
        if (media.epoch < epoch || (media.epoch === epoch && media.frameId <= frameId) || media.receivedAtMs < receivedAt) {
            staleFrames = add(staleFrames); frame.close(); return;
        }
        if (media.epoch !== epoch) clear();
        epoch = media.epoch; frameId = media.frameId; receivedAt = media.receivedAtMs;
        pending.push(frame);
        if (pending.length > MAX_PENDING) {
            // Retain the earliest deadline as well as fresh frames; dropping only oldest can starve at high FPS.
            pending.splice(1, 1)[0].close(); skippedFrames = add(skippedFrames);
        }
    }
    function advance(): boolean {
        const previous = current;
        const estimate = clock?.estimate();
        if (clock && !estimate) { clear(); return previous !== undefined; }
        const target = estimate ? estimate.serverTimeMs - estimate.uncertaintyMs - TILE_MEDIA_DELAY_MS : Infinity;
        let selected: WallLiveFrame | undefined;
        while (pending.length && pending[0].media.receivedAtMs <= target) {
            const next = pending.shift()!;
            if (estimate && target - next.media.receivedAtMs > MAX_LATE_MS) {
                next.close(); lateFrames = add(lateFrames); continue;
            }
            if (selected) { selected.close(); skippedFrames = add(skippedFrames); }
            selected = next;
        }
        if (selected) {
            current?.close(); current = selected; selectedFrames = add(selectedFrames);
            selectedAtMs = estimate ? Math.round(estimate.serverTimeMs) : null;
            clockUncertaintyMs = estimate?.uncertaintyMs ?? null;
        }
        else if (current) {
            if (estimate && target - current.media.receivedAtMs > MAX_HOLD_MS) {
                current.close(); current = undefined; selectedAtMs = null; clockUncertaintyMs = null;
            }
            else repeatedSelections = add(repeatedSelections);
        }
        return current !== previous;
    }
    return { push, advance, clear, get: () => current,
        stats: () => ({ receivedFrames, receivedBytes, selectedFrames, repeatedSelections, skippedFrames, lateFrames, staleFrames,
            pendingFrames: pending.length, epoch: current?.media.epoch.toString() ?? null,
            frameId: current?.media.frameId.toString() ?? null, receivedAtMs: current?.media.receivedAtMs ?? null,
            selectedAtMs, clockUncertaintyMs, bufferMs: TILE_MEDIA_DELAY_MS }),
    };
}
