import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeLivePreview } from "../../src/services/liveGpuPreviewScheduler";

const subscriptions: ReturnType<typeof subscribeLivePreview>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    for (const subscription of subscriptions.splice(0)) subscription.dispose();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("shared Live geometry scheduler", () => {
    it("samples all Unit bounds once per batch rather than once per Live", async () => {
        const units = Array.from({ length: 8 }, () => {
            const unit = document.createElement("div");
            unit.className = "unit-container";
            document.body.append(unit);
            return vi.spyOn(unit, "getBoundingClientRect");
        });
        const ticks = Array.from({ length: 4 }, () => vi.fn((sample) => sample.unitRects()));
        for (const tick of ticks) subscriptions.push(subscribeLivePreview(tick));
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(1);
        for (const rect of units) expect(rect).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("scroll"));
        subscriptions[0].invalidate();
        await vi.advanceTimersByTimeAsync(0);
        for (const rect of units) expect(rect).toHaveBeenCalledTimes(2);
        for (const tick of ticks) expect(tick).toHaveBeenCalledTimes(2);
    });

    it("removing a sibling keeps the shared clock and the last removal cleans it", async () => {
        const first = vi.fn(); const second = vi.fn();
        subscriptions.push(subscribeLivePreview(first), subscribeLivePreview(second));
        await vi.advanceTimersByTimeAsync(0);
        subscriptions[0].dispose();
        await vi.advanceTimersByTimeAsync(80);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(2);
        subscriptions[1].dispose();
        window.dispatchEvent(new Event("resize"));
        expect(vi.getTimerCount()).toBe(0);
    });
});
