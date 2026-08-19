import { afterEach, describe, expect, it, vi } from "vitest";

import { createStickerEditSyncScheduler } from "../../src/services/stickerEditSyncScheduler";

afterEach(() => {
    vi.useRealTimers();
});

const createHarness = () => {
    const propagateResize = vi.fn();
    const performSync = vi.fn();
    const scheduler = createStickerEditSyncScheduler({
        debounceMs: 140,
        propagateResize,
        performSync,
    });
    return { performSync, propagateResize, scheduler };
};

describe("sticker edit sync scheduler", () => {
    it("coalesces opacity followed by resize into one propagated workflow sync", () => {
        vi.useFakeTimers();
        const { performSync, propagateResize, scheduler } = createHarness();

        scheduler.scheduleAppearance();
        vi.advanceTimersByTime(40);
        scheduler.scheduleResize("sticker-1");
        vi.advanceTimersByTime(140);

        expect(propagateResize).toHaveBeenCalledOnce();
        expect(propagateResize).toHaveBeenCalledWith("sticker-1");
        expect(performSync).toHaveBeenCalledOnce();
    });

    it("coalesces resize followed by opacity without losing resize propagation", () => {
        vi.useFakeTimers();
        const { performSync, propagateResize, scheduler } = createHarness();

        scheduler.scheduleResize("sticker-1");
        vi.advanceTimersByTime(40);
        scheduler.scheduleAppearance();
        vi.advanceTimersByTime(140);

        expect(propagateResize).toHaveBeenCalledOnce();
        expect(propagateResize).toHaveBeenCalledWith("sticker-1");
        expect(performSync).toHaveBeenCalledOnce();
    });

    it("cancels pending work when the canvas unmounts", () => {
        vi.useFakeTimers();
        const { performSync, propagateResize, scheduler } = createHarness();

        scheduler.scheduleResize("sticker-1");
        scheduler.dispose();
        vi.runAllTimers();

        expect(propagateResize).not.toHaveBeenCalled();
        expect(performSync).not.toHaveBeenCalled();
    });

    it("retains resize propagation for every edited sticker in one debounce window", () => {
        vi.useFakeTimers();
        const { performSync, propagateResize, scheduler } = createHarness();

        scheduler.scheduleResize("sticker-1");
        scheduler.scheduleResize("sticker-2");
        vi.advanceTimersByTime(140);

        expect(propagateResize).toHaveBeenCalledTimes(2);
        expect(propagateResize).toHaveBeenNthCalledWith(1, "sticker-1");
        expect(propagateResize).toHaveBeenNthCalledWith(2, "sticker-2");
        expect(performSync).toHaveBeenCalledOnce();
    });
});
