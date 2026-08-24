import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SyncScheduler } from "../../src/services/syncService/scheduler";

describe("SyncScheduler", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("debounces repeated requests into one sync cycle", async () => {
        const doSync = vi.fn(async () => undefined);
        const scheduler = new SyncScheduler(doSync);

        scheduler.schedule();
        scheduler.schedule();
        scheduler.schedule();
        await vi.advanceTimersByTimeAsync(50);

        expect(doSync).toHaveBeenCalledTimes(1);
        scheduler.dispose();
    });

    it("cancels owned retry timers when disposed", async () => {
        const doSync = vi.fn(async () => {
            throw new Error("expected sync failure");
        });
        const scheduler = new SyncScheduler(doSync);

        scheduler.schedule();
        await vi.advanceTimersByTimeAsync(50);
        expect(doSync).toHaveBeenCalledTimes(1);

        scheduler.dispose();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(doSync).toHaveBeenCalledTimes(1);
    });
});
