// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/uiRegistry", () => ({
    updatePortOffset: vi.fn(),
}));

import { createUnitParamsPortRegistryController } from "../../src/components/unitParamsPortRegistryController";
import { updatePortOffset } from "../../src/services/uiRegistry";

describe("unit params port registry controller", () => {
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;

    beforeEach(() => {
        vi.useFakeTimers();
        rafCallbacks.clear();
        nextRafId = 1;
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
            const id = nextRafId++;
            rafCallbacks.set(id, callback);
            return id;
        });
        vi.stubGlobal("cancelAnimationFrame", (id: number) => {
            rafCallbacks.delete(id);
        });
    });

    afterEach(() => {
        document.body.innerHTML = "";
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    const createElements = () => {
        const unit = document.createElement("div");
        unit.className = "unit-container";
        const port = document.createElement("div");
        unit.append(port);
        document.body.append(unit);
        vi.spyOn(unit, "getBoundingClientRect").mockReturnValue({
            left: 10,
            top: 20,
            width: 200,
            height: 100,
            right: 210,
            bottom: 120,
            x: 10,
            y: 20,
            toJSON: () => ({}),
        });
        vi.spyOn(port, "getBoundingClientRect").mockReturnValue({
            left: 30,
            top: 50,
            width: 10,
            height: 10,
            right: 40,
            bottom: 60,
            x: 30,
            y: 50,
            toJSON: () => ({}),
        });
        return port;
    };

    it("cancels and suppresses deferred updates after disposal", () => {
        const controller = createUnitParamsPortRegistryController(() => "unit-a");
        controller.register(createElements(), "input");
        expect(updatePortOffset).toHaveBeenCalledTimes(1);
        const callbacks = [...rafCallbacks.values()];

        controller.dispose();
        callbacks.forEach((callback) => callback(0));
        vi.advanceTimersByTime(50);
        expect(updatePortOffset).toHaveBeenCalledTimes(1);
        expect(rafCallbacks.size).toBe(0);
    });

    it("lets only the newest element update a repeated port registration", () => {
        const controller = createUnitParamsPortRegistryController(() => "unit-a");
        controller.register(createElements(), "input");
        const staleCallbacks = [...rafCallbacks.values()];
        controller.register(createElements(), "input");
        expect(updatePortOffset).toHaveBeenCalledTimes(2);

        staleCallbacks.forEach((callback) => callback(0));
        expect(updatePortOffset).toHaveBeenCalledTimes(2);
        controller.dispose();
    });

    it("releases a settled element so a later registration starts cleanly", () => {
        const controller = createUnitParamsPortRegistryController(() => "unit-a");
        controller.register(createElements(), "input");
        const callbacks = [...rafCallbacks.entries()];
        callbacks.forEach(([id, callback]) => {
            rafCallbacks.delete(id);
            callback(0);
        });
        vi.advanceTimersByTime(50);
        expect(updatePortOffset).toHaveBeenCalledTimes(3);

        controller.register(createElements(), "input");
        expect(updatePortOffset).toHaveBeenCalledTimes(4);
        controller.dispose();
    });

    it("does not schedule registrations after disposal", () => {
        const controller = createUnitParamsPortRegistryController(() => "unit-a");
        controller.dispose();
        controller.register(createElements(), "input");

        expect(updatePortOffset).not.toHaveBeenCalled();
        expect(rafCallbacks.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});
