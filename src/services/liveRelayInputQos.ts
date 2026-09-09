const LOW_LATENCY_POINTER_INTERVAL_MS = 16;
const ELEVATED_LATENCY_POINTER_INTERVAL_MS = 33;
const HIGH_LATENCY_POINTER_INTERVAL_MS = 66;

export function liveRelayPointerIntervalMs(roundTripLatencyMs?: number | null): number {
    if (roundTripLatencyMs === undefined || roundTripLatencyMs === null) {
        return LOW_LATENCY_POINTER_INTERVAL_MS;
    }
    if (!Number.isFinite(roundTripLatencyMs) || roundTripLatencyMs < 0) {
        throw new Error("live relay round-trip latency is invalid");
    }
    if (roundTripLatencyMs <= 120) return LOW_LATENCY_POINTER_INTERVAL_MS;
    if (roundTripLatencyMs <= 300) return ELEVATED_LATENCY_POINTER_INTERVAL_MS;
    return HIGH_LATENCY_POINTER_INTERVAL_MS;
}

export function liveRelayPointerDelayMs(
    lastSentAtMs: number | undefined,
    nowMs: number,
    roundTripLatencyMs?: number | null,
): number {
    if (!Number.isFinite(nowMs)) throw new Error("live relay pointer clock is invalid");
    if (lastSentAtMs === undefined) return 0;
    if (!Number.isFinite(lastSentAtMs) || lastSentAtMs > nowMs) return 0;
    return Math.max(0, liveRelayPointerIntervalMs(roundTripLatencyMs) - (nowMs - lastSentAtMs));
}
