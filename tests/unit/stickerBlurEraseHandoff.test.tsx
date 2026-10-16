// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSignal, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { renderStickerEffectOverlay } from "../../src/features/stickers/components/StickerEffectOverlay";
import { acquireStickerBlurTexture } from "../../src/features/stickers/services/stickerBlurTexture";
import { StickerAnnotationElements } from "../../src/features/stickers/components/StickerAnnotationElements";
import { createStickerAnnotationPersistence } from "../../src/features/stickers/components/stickerAnnotationPersistenceController";
import { graphStore } from "../../src/features/workspace/state/graphStore";

vi.mock("../../src/features/stickers/services/stickerBlurTexture", () => ({ acquireStickerBlurTexture: vi.fn() }));
vi.mock("../../src/features/workspace/services/syncService", () => ({
    syncService: { performWorkflowSync: vi.fn().mockResolvedValue(undefined), updateBackendRects: vi.fn().mockResolvedValue(undefined) },
}));
const images: ControlledImage[] = [];
class ControlledImage {
    src = ""; naturalWidth = 200; naturalHeight = 100;
    finish!: () => void;
    constructor() { images.push(this); }
    decode = () => new Promise<void>((resolve) => { this.finish = resolve; });
    removeAttribute() { this.src = ""; }
}
let dispose: (() => void) | undefined;
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const decode = async (src: string) => {
    const image = images.findLast((entry) => entry.src === src);
    expect(image, `decoder for ${src}`).toBeDefined();
    image!.finish(); await flush();
};
const imageHref = () => document.querySelector("pattern image")?.getAttribute("href");
beforeEach(() => { images.length = 0; vi.stubGlobal("Image", ControlledImage); });
afterEach(() => {
    dispose?.(); dispose = undefined; document.body.replaceChildren();
    graphStore.actions.replaceUnits([]); vi.unstubAllGlobals(); vi.resetAllMocks(); vi.useRealTimers();
});

const mount = (strength: Accessor<number> = () => 8) => {
    const [source, setSource] = createSignal<string | undefined>("data:before-erase");
    dispose = render(() => <svg>{renderStickerEffectOverlay({
        effectType: "blur", points: [{ x: 10, y: 20 }, { x: 100, y: 20 }],
        brushWidth: 30, get strength() { return strength(); }, maskId: "existing-blur", x: 0, y: 0, w: 200, h: 100,
        get imageSrc() { return source(); }, stickerWidth: 200, stickerHeight: 100,
    })}</svg>, document.body);
    return setSource;
};

it("keeps the existing blur and its lease until erased pixels have a decoded replacement", async () => {
    const releaseOld = vi.fn(); const releaseNew = vi.fn();
    let finishNew!: (url: string | null) => void;
    vi.mocked(acquireStickerBlurTexture)
        .mockReturnValueOnce({ url: "blob:old-blur", ready: Promise.resolve("blob:old-blur"), release: releaseOld })
        .mockReturnValueOnce({ url: null, ready: new Promise((resolve) => { finishNew = resolve; }), release: releaseNew });
    const setSource = mount();
    await decode("blob:old-blur");
    const pattern = document.querySelector("pattern");
    const stroke = document.querySelector("path");
    expect(imageHref()).toBe("blob:old-blur");
    setSource("data:after-erase");
    expect(document.querySelector("pattern")).toBe(pattern);
    expect(document.querySelector("path")).toBe(stroke);
    expect(imageHref()).toBe("blob:old-blur");
    expect(releaseOld).not.toHaveBeenCalled();
    await decode("data:after-erase");
    expect(imageHref()).toBe("blob:old-blur");
    finishNew("blob:new-blur"); await flush();
    expect(imageHref()).toBe("blob:old-blur");
    await decode("blob:new-blur");
    expect(document.querySelector("pattern")).toBe(pattern);
    expect(imageHref()).toBe("blob:new-blur");
    expect(document.querySelector("filter")).toBeNull();
    expect(releaseOld).toHaveBeenCalledOnce();
    dispose?.(); dispose = undefined;
    expect(releaseNew).toHaveBeenCalledOnce();
});

it("discards superseded requests and releases displayed and pending leases on disposal", async () => {
    const releases = [vi.fn(), vi.fn(), vi.fn()];
    let finishStale!: (url: string | null) => void;
    let finishLast!: (url: string | null) => void;
    vi.mocked(acquireStickerBlurTexture)
        .mockReturnValueOnce({ url: "blob:old", ready: Promise.resolve("blob:old"), release: releases[0] })
        .mockReturnValueOnce({ url: null, ready: new Promise((resolve) => { finishStale = resolve; }), release: releases[1] })
        .mockReturnValueOnce({ url: null, ready: new Promise((resolve) => { finishLast = resolve; }), release: releases[2] });
    const setSource = mount(); await decode("blob:old");
    setSource("data:second"); setSource("data:third");
    expect(releases[1]).toHaveBeenCalledOnce();
    expect(releases[0]).not.toHaveBeenCalled();
    finishStale("blob:stale"); await flush();
    expect(imageHref()).toBe("blob:old");
    expect(images.some((entry) => entry.src === "blob:stale")).toBe(false);
    dispose?.(); dispose = undefined;
    finishLast("blob:late"); await flush();
    for (const release of releases) expect(release).toHaveBeenCalledOnce();
    expect(images.every((entry) => entry.src === "")).toBe(true);
});

it("uses a decoded SVG fallback when the raster cache cannot supply the replacement", async () => {
    const releaseOld = vi.fn();
    vi.mocked(acquireStickerBlurTexture)
        .mockReturnValueOnce({ url: "blob:old", ready: Promise.resolve("blob:old"), release: releaseOld })
        .mockReturnValueOnce({ url: null, ready: Promise.resolve(null), release: vi.fn() });
    const setSource = mount(); await decode("blob:old");
    const pattern = document.querySelector("pattern");
    setSource("data:after-erase"); await flush();
    expect(imageHref()).toBe("blob:old");
    await decode("data:after-erase");
    expect(document.querySelector("pattern")).toBe(pattern);
    expect(imageHref()).toBe("data:after-erase");
    expect(document.querySelector("pattern image")?.getAttribute("filter")).toMatch(/^url\(#/);
    expect(document.querySelector("feGaussianBlur")?.getAttribute("stdDeviation")).toBe("8");
    expect(releaseOld).toHaveBeenCalledOnce();
});

it("does not retain a weaker blur after strength changes or retain content after source removal", async () => {
    const releaseOld = vi.fn();
    vi.mocked(acquireStickerBlurTexture)
        .mockReturnValueOnce({ url: "blob:old", ready: Promise.resolve("blob:old"), release: releaseOld })
        .mockReturnValue({ url: null, ready: Promise.resolve(null), release: vi.fn() });
    const [strength, setStrength] = createSignal(8);
    const setSource = mount(strength); await decode("blob:old");
    setStrength(16);
    expect(document.querySelector("path")?.getAttribute("stroke")).toBe("#808a96");
    expect(releaseOld).toHaveBeenCalledOnce();
    await decode("data:before-erase");
    expect(document.querySelector("feGaussianBlur")?.getAttribute("stdDeviation")).toBe("16");
    setSource(undefined);
    expect(document.querySelector("pattern")).toBeNull();
    expect(document.querySelector("path")?.getAttribute("stroke")).toBe("#808a96");
});

it("keeps annotation objects and SVG nodes through the real graph persistence handoff", async () => {
    vi.mocked(acquireStickerBlurTexture)
        .mockReturnValueOnce({ url: "blob:old", ready: Promise.resolve("blob:old"), release: vi.fn() })
        .mockReturnValueOnce({ url: "blob:new", ready: Promise.resolve("blob:new"), release: vi.fn() });
    graphStore.actions.replaceUnits([{
        id: "blur-erase", type: "sticker", x: 0, y: 0, w: 200, h: 100, params: {}, inputs: [], outputs: [],
        data: { src: "data:before-erase", annotationState: { serialCounter: 1, elements: [{
            id: "blur", type: "blur", zIndex: 1, x: 0, y: 0, w: 100, h: 30,
            points: [{ x: 10, y: 20 }, { x: 100, y: 20 }], strength: 8,
            style: { color: "#000", width: 30, opacity: 1 },
        }] } },
    }]);
    const unit = () => graphStore.units[0];
    const state = () => unit().data.annotationState!;
    const annotation = state().elements[0];
    dispose = render(() => <svg><StickerAnnotationElements annotations={state().elements}
        contentEraseStrokes={[]} highlighterAnnotations={[]} imageSrc={unit().data.src}
        stickerWidth={unit().w} stickerHeight={unit().h} polygonSides={3} renderTextAnnotation={() => null} /></svg>, document.body);
    await decode("blob:old");
    const group = document.querySelector('[data-sticker-annotation-id="blur"]');
    const pattern = document.querySelector("pattern");
    const stroke = document.querySelector("path");
    const persistence = createStickerAnnotationPersistence({ unitId: () => unit().id, unit, annotationState: state });
    await persistence.patchUnitData({ src: "data:after-erase", previewSrc: "data:after-erase" });
    expect(state().elements[0]).toBe(annotation);
    expect(document.querySelector('[data-sticker-annotation-id="blur"]')).toBe(group);
    expect(document.querySelector("pattern")).toBe(pattern);
    expect(document.querySelector("path")).toBe(stroke);
    expect(imageHref()).toBe("blob:old");
    await decode("blob:new");
    expect(imageHref()).toBe("blob:new");
    expect(document.querySelector("pattern")).toBe(pattern);
});
