// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { installNativeFocusPolling } from "../../src/services/nativeFocusPolling";

const flushPromises = async () => {
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
};

describe("native focus polling", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("serializes polling and only reports focus transitions", async () => {
        vi.useFakeTimers();
        let resolveFirst!: (focused: boolean) => void;
        const first = new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
        });
        const hasForegroundWindow = vi.fn()
            .mockReturnValueOnce(first)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        const notifyFocusChanged = vi.fn();
        const dispose = installNativeFocusPolling({
            hasForegroundWindow,
            notifyFocusChanged,
            intervalMs: 10,
        });

        await vi.advanceTimersByTimeAsync(20);
        expect(hasForegroundWindow).toHaveBeenCalledTimes(1);
        resolveFirst(true);
        await flushPromises();
        expect(notifyFocusChanged).toHaveBeenCalledWith(true);

        await vi.advanceTimersByTimeAsync(20);
        expect(notifyFocusChanged).toHaveBeenCalledWith(false);
        dispose();
    });

    it("does not notify after an in-flight poll is disposed", async () => {
        let resolvePoll!: (focused: boolean) => void;
        const hasForegroundWindow = vi.fn(() => new Promise<boolean>((resolve) => {
            resolvePoll = resolve;
        }));
        const notifyFocusChanged = vi.fn();
        const dispose = installNativeFocusPolling({ hasForegroundWindow, notifyFocusChanged });

        dispose();
        resolvePoll(true);
        await flushPromises();

        expect(notifyFocusChanged).not.toHaveBeenCalled();
    });
});
