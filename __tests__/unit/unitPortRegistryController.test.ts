// @vitest-environment jsdom

import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Unit } from "../../src/types/unit";

const registry = vi.hoisted(() => ({
    addOrUpdateRect: vi.fn(),
    removeRect: vi.fn(),
    updatePortOffset: vi.fn(),
}));

vi.mock("../../src/services/uiRegistry", () => registry);

import { createUnitPortRegistryController } from "../../src/components/unitPortRegistryController";

const unit: Unit = {
    id: "port-unit",
    type: "sticker",
    x: 10,
    y: 20,
    w: 100,
    h: 80,
    params: {},
    inputs: [],
    outputs: [],
    data: {},
};

describe("unit port registry controller", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("cancels delayed panel measurements and removes native hit rectangles on cleanup", () => {
        const frames = new Map<number, FrameRequestCallback>();
        let nextFrameId = 1;
        const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            const id = nextFrameId++;
            frames.set(id, callback);
            return id;
        });
        const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
            frames.delete(id);
        });
        const clearTimer = vi.spyOn(window, "clearTimeout");
        const element = document.createElement("div");
        element.className = "unit-container";
        const panelPort = document.createElement("div");
        panelPort.dataset.panelPort = "true";
        panelPort.dataset.portName = "image";
        element.append(panelPort);
        document.body.append(element);

        let dispose: () => void = () => undefined;
        createRoot((rootDispose) => {
            dispose = rootDispose;
            createUnitPortRegistryController({
                unit: () => unit,
                inputs: () => [{ name: "image" }],
                outputs: () => [{ name: "output_image" }],
                element: () => element,
            });
        });

        expect(requestFrame).toHaveBeenCalledTimes(1);
        frames.get(1)?.(performance.now());
        expect(registry.updatePortOffset).toHaveBeenCalledTimes(1);
        expect(requestFrame).toHaveBeenCalledTimes(2);

        dispose();
        expect(cancelFrame).toHaveBeenCalledWith(2);
        expect(clearTimer).toHaveBeenCalled();
        expect(registry.removeRect).toHaveBeenCalledWith("port-in-port-unit-0");
        expect(registry.removeRect).toHaveBeenCalledWith("port-out-port-unit-0");

        vi.runAllTimers();
        expect(registry.updatePortOffset).toHaveBeenCalledTimes(1);
    });
});
