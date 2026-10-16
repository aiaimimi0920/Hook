// @vitest-environment jsdom
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FitImageFrameButton } from "../../src/features/stickers/components/FitImageFrameButton";
import { setLayoutTick } from "../../src/features/workspace/state/uiStore";
import type { Unit } from "../../src/features/workspace/types/unit";

vi.mock("../../src/features/workspace/state/uiStore", () => ({ setLayoutTick: vi.fn() }));

class ImageMock {
    static instances: ImageMock[] = [];
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 400;
    height = 200;
    naturalWidth = 400;
    naturalHeight = 200;
    src = "";
    constructor() { ImageMock.instances.push(this); }
}

const UNIT: Unit = {
    id: "resize-unit", type: "art", x: 0, y: 0, w: 200, h: 200,
    params: {}, inputs: [], outputs: [], data: {},
};
let dispose: (() => void) | undefined;
const mount = (view: () => ReturnType<typeof FitImageFrameButton>) => {
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(view, host);
    host.querySelector<HTMLButtonElement>("button[aria-label='合拢外框']")!.click();
    return host;
};

describe("FitImageFrameButton image resize lifecycle", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        ImageMock.instances = [];
        vi.stubGlobal("Image", ImageMock);
    });
    afterEach(() => {
        dispose?.();
        dispose = undefined;
        document.body.replaceChildren();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });
    it("ignores a load from an obsolete image source", () => {
        const [src, setSrc] = createSignal("data:image/png;base64,OLD");
        const onFit = vi.fn();
        mount(() => <FitImageFrameButton unit={UNIT} displaySrc={src()} onFit={onFit} />);
        setSrc("data:image/png;base64,NEW");
        ImageMock.instances[0].onload?.();
        expect(onFit).not.toHaveBeenCalled();
    });
    it("commits the current ratio but cancels delayed layout work on disposal", () => {
        const onFit = vi.fn();
        mount(() => <FitImageFrameButton unit={UNIT} displaySrc="data:image/png;base64,CURRENT" onFit={onFit} />);
        ImageMock.instances[0].onload?.();
        expect(onFit).toHaveBeenCalledWith({ w: 200, h: 100 });
        dispose?.(); dispose = undefined;
        vi.advanceTimersByTime(50);
        expect(setLayoutTick).not.toHaveBeenCalled();
    });
    it("publishes the layout tick after the resize updates parent geometry", () => {
        const [unit, setUnit] = createSignal(UNIT);
        mount(() => <FitImageFrameButton unit={unit()} displaySrc="data:image/png;base64,CURRENT"
            onFit={(size) => setUnit((current) => ({ ...current, ...size }))} />);
        ImageMock.instances[0].onload?.();
        expect(unit().h).toBe(100);
        vi.advanceTimersByTime(50);
        expect(setLayoutTick).toHaveBeenCalledTimes(1);
    });
    it("detaches a pending image callback when disposed", () => {
        const onFit = vi.fn();
        mount(() => <FitImageFrameButton unit={UNIT} displaySrc="data:image/png;base64,LATE" onFit={onFit} />);
        const image = ImageMock.instances[0];
        const lateLoad = image.onload;
        dispose?.(); dispose = undefined;
        expect(image.onload).toBeNull();
        expect(image.onerror).toBeNull();
        lateLoad?.();
        expect(onFit).not.toHaveBeenCalled();
    });
});
