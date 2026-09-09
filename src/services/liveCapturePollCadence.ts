import { liveFrameDelay } from "./liveCapturePresentation";

const GPU_STATUS_INTERVAL_MS = 250;
const GPU_PRESENTATION_LEASE_MS = 500;
type Lease = { expiresAt: number; wakeFallback: () => void };
const leases = new Map<string, Lease>();

/** Only an acknowledged native mirror can suppress high-frequency JPEG polling. */
export function setLiveGpuPresenting(sessionId: string, presenting: boolean): void {
    const lease = leases.get(sessionId);
    if (!lease) return;
    const wasPresenting = lease.expiresAt > 0;
    lease.expiresAt = presenting ? performance.now() + GPU_PRESENTATION_LEASE_MS : 0;
    if (!presenting && wasPresenting) lease.wakeFallback();
}

/** Registration is owned by the capture controller, not by transient image elements. */
export function createLiveCapturePollCadence() {
    const owned = new Map<string, Lease>();
    const forget = (sessionId: string) => {
        const lease = owned.get(sessionId);
        if (lease && leases.get(sessionId) === lease) leases.delete(sessionId);
        owned.delete(sessionId);
    };
    return {
        register(sessionId: string, wakeFallback: () => void): void {
            const lease = { expiresAt: 0, wakeFallback };
            owned.set(sessionId, lease);
            leases.set(sessionId, lease);
        },
        delay(sessionId: string, targetFps: number, elapsedMs = 0): number {
            const lease = owned.get(sessionId);
            return lease && leases.get(sessionId) === lease && lease.expiresAt > performance.now()
                ? Math.max(1, GPU_STATUS_INTERVAL_MS - Math.max(0, elapsedMs))
                : liveFrameDelay(targetFps, elapsedMs);
        },
        forget,
        clear(): void { for (const id of owned.keys()) forget(id); },
    };
}
