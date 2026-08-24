// @vitest-environment jsdom

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/api", () => ({
    api: { focusOverlayWindow: vi.fn().mockResolvedValue(undefined) },
}));

import {
    UNIT_PARAMS_SCROLL_REGISTRY_LIMIT,
    UnitParamsScrollRegion,
    getUnitParamsScrollRegistrySize,
    readUnitParamsScrollTop,
    rememberUnitParamsScrollTop,
} from "../../src/components/UnitParamsScrollRegion";
import type { Unit } from "../../src/types/unit";

class ResizeObserverMock {
    observe() {}
    disconnect() {}
}

const UNIT: Unit = {
    id: "scroll-lifecycle-unit",
    type: "art",
    artId: "test-art",
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    params: {},
    inputs: [],
    outputs: [],
    data: {},
};

describe("UnitParamsScrollRegion lifecycle", () => {
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    const cancelledRafs: number[] = [];
    let nextRafId = 1;

    beforeEach(() => {
        rafCallbacks.clear();
        cancelledRafs.length = 0;
        nextRafId = 1;
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
            const id = nextRafId++;
            rafCallbacks.set(id, callback);
            return id;
        });
        vi.stubGlobal("cancelAnimationFrame", (id: number) => {
            cancelledRafs.push(id);
            rafCallbacks.delete(id);
        });
    });

    afterEach(() => {
        document.body.innerHTML = "";
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("cancels pending metric and restore frames on disposal", () => {
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <UnitParamsScrollRegion
                    unit={UNIT}
                    params={[]}
                    renderParamControl={() => null}
                />
            ),
            host,
        );
        const pendingIds = [...rafCallbacks.keys()];
        expect(pendingIds.length).toBeGreaterThan(0);
        dispose();

        expect(cancelledRafs).toEqual(expect.arrayContaining(pendingIds));
        expect(rafCallbacks.size).toBe(0);
    });

    it("bounds remembered unit scroll positions while preserving recent entries", () => {
        const prefix = `bounded-${Date.now()}-`;
        for (let index = 0; index <= UNIT_PARAMS_SCROLL_REGISTRY_LIMIT; index += 1) {
            rememberUnitParamsScrollTop(`${prefix}${index}`, index);
        }

        expect(getUnitParamsScrollRegistrySize()).toBeLessThanOrEqual(UNIT_PARAMS_SCROLL_REGISTRY_LIMIT);
        expect(readUnitParamsScrollTop(`${prefix}0`)).toBeUndefined();
        expect(readUnitParamsScrollTop(`${prefix}${UNIT_PARAMS_SCROLL_REGISTRY_LIMIT}`)).toBe(
            UNIT_PARAMS_SCROLL_REGISTRY_LIMIT,
        );
    });
});
