import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveCapturePollCadence, setLiveGpuPresenting } from "../../src/services/liveCapturePollCadence";

const policies: ReturnType<typeof createLiveCapturePollCadence>[] = [];
const create = () => { const policy = createLiveCapturePollCadence(); policies.push(policy); return policy; };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { policies.splice(0).forEach((policy) => policy.clear()); vi.useRealTimers(); });

describe("native GPU status-only polling", () => {
    it("preserves first-frame and JPEG cadence until native presentation is acknowledged", () => {
        const policy = create();
        policy.register("one", vi.fn());
        expect(policy.delay("one", 60)).toBeCloseTo(1000 / 60);
        setLiveGpuPresenting("one", true);
        expect(policy.delay("one", 60)).toBe(250);
        expect(policy.delay("one", 60, 40)).toBe(210);
        expect(policy.delay("one", 60, 400)).toBe(1);
    });

    it("expires a lost preview lease instead of permanently suppressing JPEG polling", () => {
        const policy = create(); policy.register("one", vi.fn());
        setLiveGpuPresenting("one", true);
        vi.advanceTimersByTime(501);
        expect(policy.delay("one", 60)).toBeCloseTo(1000 / 60);
    });

    it("wakes fallback immediately once on disable, fault or handoff", () => {
        const wake = vi.fn(); const policy = create(); policy.register("one", wake);
        setLiveGpuPresenting("one", true);
        setLiveGpuPresenting("one", false);
        setLiveGpuPresenting("one", false);
        expect(wake).toHaveBeenCalledOnce();
        expect(policy.delay("one", 60)).toBeCloseTo(1000 / 60);
    });

    it("keeps sessions independent and removes closed-session registrations", () => {
        const policy = create(); const wake = vi.fn();
        policy.register("one", wake); policy.register("two", vi.fn());
        setLiveGpuPresenting("one", true);
        expect(policy.delay("two", 60)).toBeCloseTo(1000 / 60);
        policy.forget("one");
        setLiveGpuPresenting("one", false);
        expect(wake).not.toHaveBeenCalled();
    });
});
