/** RTT midpoint estimate on a monotonic local clock. Boot changes invalidate all prior samples. */
import type { WallTiming } from './wallTypes';

interface Sample { offset: number; rtt: number; received: number }
export function createTileClock(now = () => performance.now()) {
    let id = '';
    let samples: Sample[] = [];
    function observe(timing: WallTiming, sent: number, received: number): boolean {
        const changed = Boolean(id && id !== timing.clockId);
        if (id !== timing.clockId) { id = timing.clockId; samples = []; }
        const rtt = received - sent;
        if (Number.isFinite(rtt) && rtt >= 0 && rtt <= 1000) {
            samples = [...samples.filter((sample) => received - sample.received <= 15_000),
                { offset: timing.serverTimeMs - (sent + received) / 2, rtt, received }].slice(-8);
        }
        return changed;
    }
    function estimate() {
        const local = now();
        const best = samples.filter((sample) => local - sample.received <= 15_000 && local >= sample.received)
            .sort((a, b) => a.rtt - b.rtt)[0];
        if (!best) return undefined;
        return { serverTimeMs: local + best.offset,
            uncertaintyMs: Math.ceil(best.rtt / 2 + (local - best.received) * 0.0001 + 1) };
    }
    return { observe, estimate, id: () => id };
}
export type TileClock = ReturnType<typeof createTileClock>;
