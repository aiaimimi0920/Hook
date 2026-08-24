// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PARAM_ui_resize } from "../../src/constants";

vi.mock("../../src/services/api", () => ({
    api: { focusOverlayWindow: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../src/services/syncService", () => ({
    syncService: { performWorkflowSync: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../../src/services/uiRegistry", () => ({
    addOrUpdateRect: vi.fn(),
    removeRect: vi.fn(),
}));
vi.mock("../../src/store/uiStore", () => ({
    setLayoutTick: vi.fn(),
}));

import { UnitParamsExpandedSettings } from "../../src/components/UnitParamsExpandedSettings";
import { setLayoutTick } from "../../src/store/uiStore";
import type { Unit } from "../../src/types/unit";

class ResizeObserverMock {
    observe() {}
    disconnect() {}
}

class ImageMock {
    static instances: ImageMock[] = [];
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 400;
    height = 200;
    naturalWidth = 400;
    naturalHeight = 200;
    src = "";

    constructor() {
        ImageMock.instances.push(this);
    }
}

const UNIT: Unit = {
    id: "resize-unit",
    type: "sticker",
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    params: {},
    inputs: [],
    outputs: [],
    data: {},
};

describe("UnitParamsExpandedSettings image resize lifecycle", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        ImageMock.instances = [];
        vi.stubGlobal("Image", ImageMock);
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    });

    afterEach(() => {
        document.body.innerHTML = "";
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("ignores a load from an obsolete image source", () => {
        const [src, setSrc] = createSignal("data:image/png;base64,OLD");
        const onParamChange = vi.fn();
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <UnitParamsExpandedSettings
                    unit={UNIT}
                    expanded
                    displaySrc={src()}
                    onParamChange={onParamChange}
                />
            ),
            host,
        );

        host.querySelector<HTMLButtonElement>("button[title='适配图片比例']")!.click();
        const oldImage = ImageMock.instances[0];
        setSrc("data:image/png;base64,NEW");
        oldImage.onload?.();
        expect(onParamChange).not.toHaveBeenCalled();
        dispose();
    });

    it("commits the current ratio but cancels delayed layout work on disposal", () => {
        const onParamChange = vi.fn();
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <UnitParamsExpandedSettings
                    unit={UNIT}
                    expanded
                    displaySrc="data:image/png;base64,CURRENT"
                    onParamChange={onParamChange}
                />
            ),
            host,
        );

        host.querySelector<HTMLButtonElement>("button[title='适配图片比例']")!.click();
        ImageMock.instances[0].onload?.();
        expect(onParamChange).toHaveBeenCalledWith(PARAM_ui_resize, { w: 200, h: 100 });
        dispose();
        vi.advanceTimersByTime(50);
        expect(setLayoutTick).not.toHaveBeenCalled();
    });

    it("publishes the layout tick after the resize updates parent geometry", () => {
        const [unit, setUnit] = createSignal(UNIT);
        const onParamChange = vi.fn((propId: string, value: unknown) => {
            if (propId !== PARAM_ui_resize) return;
            const size = value as { w: number; h: number };
            setUnit((current) => ({ ...current, w: size.w, h: size.h }));
        });
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <UnitParamsExpandedSettings
                    unit={unit()}
                    expanded
                    displaySrc="data:image/png;base64,CURRENT"
                    onParamChange={onParamChange}
                />
            ),
            host,
        );

        host.querySelector<HTMLButtonElement>("button[title='适配图片比例']")!.click();
        ImageMock.instances[0].onload?.();
        expect(unit().h).toBe(100);
        vi.advanceTimersByTime(50);
        expect(setLayoutTick).toHaveBeenCalledTimes(1);
        dispose();
    });

    it("detaches a pending image callback when disposed", () => {
        const onParamChange = vi.fn();
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <UnitParamsExpandedSettings
                    unit={UNIT}
                    expanded
                    displaySrc="data:image/png;base64,LATE"
                    onParamChange={onParamChange}
                />
            ),
            host,
        );

        host.querySelector<HTMLButtonElement>("button[title='适配图片比例']")!.click();
        const image = ImageMock.instances[0];
        dispose();
        image.onload?.();
        expect(onParamChange).not.toHaveBeenCalled();
    });
});
