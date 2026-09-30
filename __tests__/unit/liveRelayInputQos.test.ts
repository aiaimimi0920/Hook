import { describe, expect, it } from "vitest";

import {
    liveRelayPointerDelayMs,
    liveRelayPointerIntervalMs,
} from "../../src/services/liveRelayInputQos";

describe("live relay high-latency input policy", () => {
    it("reduces replaceable pointer frequency as round-trip latency grows", () => {
        expect(liveRelayPointerIntervalMs(undefined)).toBe(16);
        expect(liveRelayPointerIntervalMs(120)).toBe(16);
        expect(liveRelayPointerIntervalMs(121)).toBe(33);
        expect(liveRelayPointerIntervalMs(300)).toBe(33);
        expect(liveRelayPointerIntervalMs(301)).toBe(66);
    });

    it("dispatches the first move immediately and bounds later delays", () => {
        expect(liveRelayPointerDelayMs(undefined, 1000, 500)).toBe(0);
        expect(liveRelayPointerDelayMs(980, 1000, 500)).toBe(46);
        expect(liveRelayPointerDelayMs(900, 1000, 500)).toBe(0);
    });

    it("rejects non-finite or negative round-trip measurements", () => {
        expect(() => liveRelayPointerIntervalMs(-1)).toThrow(/invalid/);
        expect(() => liveRelayPointerIntervalMs(Number.POSITIVE_INFINITY)).toThrow(/invalid/);
    });
});
