// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureRect } from "../../src/services/captureState";

const state = vi.hoisted(() => ({
    selecting: true,
    selectionRect: null as CaptureRect | null,
    preciseRect: null as CaptureRect | null,
    getPreciseSelection: vi.fn(),
    setPreciseRect: vi.fn((rect: CaptureRect | null) => {
        state.preciseRect = rect;
    }),
}));

vi.mock("../../src/services/api", () => ({
    api: { getPreciseSelection: state.getPreciseSelection },
}));

vi.mock("../../src/store/uiStore", () => ({
    isSelecting: () => state.selecting,
    selectionRect: () => state.selectionRect,
    preciseRect: () => state.preciseRect,
    setPreciseRect: state.setPreciseRect,
}));

import { createPreciseSelectionController } from "../../src/hooks/preciseSelectionController";

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const flushPromises = async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

describe("precise selection controller", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        state.selecting = true;
        state.selectionRect = null;
        state.preciseRect = null;
        Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    const createController = () => {
        let sessionGeneration = 1;
        return {
            controller: createPreciseSelectionController({
                getCaptureSessionGeneration: () => sessionGeneration,
                isCaptureSessionCurrent: (generation) => generation === sessionGeneration,
            }),
            invalidateSession: () => {
                sessionGeneration += 1;
            },
        };
    };

    it("rejects an older in-flight response and applies the current DPR-scaled rectangle", async () => {
        const first = deferred<CaptureRect | null>();
        const second = deferred<CaptureRect | null>();
        state.getPreciseSelection
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const { controller } = createController();
        const rectA = { x: 5, y: 10, w: 40, h: 20 };
        const rectB = { x: 20, y: 30, w: 100, h: 40 };

        state.selectionRect = rectA;
        controller.schedule(rectA);
        await vi.advanceTimersByTimeAsync(80);
        state.selectionRect = rectB;
        controller.schedule(rectB);
        await vi.advanceTimersByTimeAsync(80);

        expect(state.getPreciseSelection).toHaveBeenNthCalledWith(2, 40, 60, 200, 80);
        second.resolve({ x: 44, y: 64, w: 190, h: 70 });
        await flushPromises();
        expect(state.preciseRect).toEqual({ x: 22, y: 32, w: 95, h: 35 });

        first.resolve({ x: 12, y: 22, w: 70, h: 30 });
        await flushPromises();
        expect(state.preciseRect).toEqual({ x: 22, y: 32, w: 95, h: 35 });
    });

    it("invalidates in-flight work and only resolves a precise rect for its source selection", async () => {
        const response = deferred<CaptureRect | null>();
        state.getPreciseSelection.mockReturnValue(response.promise);
        const { controller, invalidateSession } = createController();
        const sourceRect = { x: 10, y: 10, w: 80, h: 60 };

        state.selectionRect = sourceRect;
        controller.schedule(sourceRect);
        await vi.advanceTimersByTimeAsync(80);
        invalidateSession();
        response.resolve({ x: 20, y: 20, w: 160, h: 120 });
        await flushPromises();

        expect(state.preciseRect).toBeNull();
        expect(controller.resolveCurrentSelectionRect(sourceRect)).toBe(sourceRect);
        expect(state.setPreciseRect.mock.calls.every(([rect]) => rect === null)).toBe(true);
    });
});
