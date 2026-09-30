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

    it("waits for a new snapshot when requested during an existing save", async () => {
        let finish!: () => void;
        const doSync = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
        const scheduler = new SyncScheduler(doSync);
        scheduler.schedule(); await vi.advanceTimersByTimeAsync(50);
        const completed = vi.fn(); const wait = scheduler.scheduleAndWait().then(completed);
        finish(); await vi.advanceTimersByTimeAsync(50);
        expect(doSync).toHaveBeenCalledTimes(2); expect(completed).not.toHaveBeenCalled();
        finish(); await wait; expect(completed).toHaveBeenCalledTimes(1);
        scheduler.dispose();
    });

    it("rejects durable waiters on save failure and disposal", async () => {
        const scheduler = new SyncScheduler(async () => { throw new Error("disk failure"); });
        const failed = expect(scheduler.scheduleAndWait()).rejects.toThrow("disk failure");
        await vi.advanceTimersByTimeAsync(50); await failed;
        const disposed = expect(scheduler.scheduleAndWait()).rejects.toThrow("sync_disposed");
        scheduler.dispose(); await disposed;
        expect(vi.getTimerCount()).toBe(0);
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
