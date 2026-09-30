/** One transient marker per presenter. Relative deadlines include time spent reading state. */
import { wallApi } from './apiWall';
import type { TileEndpoint, WallIdentification } from './wallTypes';

export interface TileIdentificationMarker { endpoint: TileEndpoint; deadline: number }
interface ActiveMarker extends TileIdentificationMarker { leaseId: string; requestId: string; generation: number }

export function createTileIdentification(
    show: (marker: TileIdentificationMarker | null) => void,
    pauseInput: () => void,
    report: typeof wallApi.reportIdentification = wallApi.reportIdentification,
) {
    let active: ActiveMarker | undefined;
    let lastKey = '';
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<void> | undefined;
    let cancelPaint: (() => void) | undefined;

    function hide() { clearTimeout(timer); timer = undefined; active = undefined; show(null); }
    function clear() { generation++; cancelPaint?.(); hide(); }
    function paint(): Promise<boolean> {
        return new Promise((resolve) => {
            let frame = 0;
            const finish = (painted: boolean) => {
                clearTimeout(timeout); cancelAnimationFrame(frame); cancelPaint = undefined; resolve(painted);
            };
            const timeout = setTimeout(() => finish(false), 500);
            cancelPaint = () => finish(false);
            frame = requestAnimationFrame(() => finish(true));
        });
    }
    function expireAt(marker: ActiveMarker) {
        clearTimeout(timer);
        timer = setTimeout(() => { if (active === marker) hide(); }, Math.max(0, marker.deadline - performance.now()));
    }
    async function apply(command: WallIdentification | undefined, endpoint: TileEndpoint, leaseId: string, observedAt: number): Promise<boolean> {
        if (!command) { clear(); return false; }
        const key = `${endpoint.endpointId}\n${leaseId}\n${command.requestId}`;
        const deadline = observedAt + command.remainingMs;
        if (key === lastKey) {
            if (active) {
                // A delayed/duplicate snapshot never extends a marker already observed locally.
                active.deadline = Math.min(active.deadline, deadline);
                if (active.deadline <= performance.now()) hide();
                else expireAt(active);
            }
            return active !== undefined;
        }
        clear(); lastKey = key;
        if (!endpoint.display?.canIdentify || deadline <= performance.now()) return false;
        const marker = { endpoint, deadline, leaseId, requestId: command.requestId, generation };
        active = marker; pauseInput(); show(marker); expireAt(marker);
        const operation = (async () => {
            const painted = await paint();
            if (!painted && active === marker) hide();
            if (active === marker && generation === marker.generation && performance.now() < marker.deadline) {
                await report(endpoint.endpointId, leaseId, marker.requestId, 'applied');
            }
        })();
        pending = operation;
        try { await operation; }
        finally { if (pending === operation) pending = undefined; }
        return active === marker;
    }
    async function dismiss() {
        const marker = active;
        if (!marker) return;
        hide();
        // Dismissal follows any in-flight applied report; repeated clicks cannot queue more work.
        await pending?.catch(() => {});
        if (generation === marker.generation) {
            await report(marker.endpoint.endpointId, marker.leaseId, marker.requestId, 'dismissed');
        }
    }
    return { apply, clear, dismiss, active: () => active !== undefined };
}
