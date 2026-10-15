// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createDecodedImageSource } from "../../src/components/decodedImageSource";
import { renderStickerEffectOverlay } from "../../src/components/StickerEffectOverlay";
vi.mock("../../src/services/stickerEffects", () => ({
    BLUR_EFFECT_OVERLAY_FILL: "rgba(255,255,255,0.08)", buildMosaicTextureDataUrl: () => "data:mosaic",
}));

const images: ControlledImage[] = [];
class ControlledImage {
    src = ""; naturalWidth = 200; naturalHeight = 100;
    finish!: () => void; fail!: () => void;
    constructor() { images.push(this); }
    decode = () => new Promise<void>((resolve, reject) => { this.finish = resolve; this.fail = () => reject(new Error("decode failed")); });
    removeAttribute() { this.src = ""; }
}
let dispose: (() => void) | undefined;
beforeEach(() => { images.length = 0; vi.stubGlobal("Image", ControlledImage); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

it("publishes only the current decoded preview and invalidates it immediately on restore", async () => {
    const [source, setSource] = createSignal<string | undefined>("data:first");
    let ready!: () => string | undefined;
    createRoot((cleanup) => { dispose = cleanup; ready = createDecodedImageSource(source); });
    expect(ready()).toBeUndefined();
    const first = images[0];
    setSource("data:second"); first.finish(); await flush();
    expect(ready()).toBeUndefined();
    images[1].finish(); await flush(); expect(ready()).toBe("data:second");
    setSource(undefined); expect(ready()).toBeUndefined();
    setSource("data:third"); dispose?.(); images[2].finish(); await flush();
    expect(ready()).toBeUndefined();
});

it("retains fallback on decode failure or timeout without accepting late pixels", async () => {
    vi.useFakeTimers();
    const [source, setSource] = createSignal("data:bad");
    let ready!: () => string | undefined;
    createRoot((cleanup) => { dispose = cleanup; ready = createDecodedImageSource(source); });
    images[0].fail(); await flush(); expect(ready()).toBeUndefined();
    setSource("data:slow"); vi.advanceTimersByTime(10_000);
    expect(images[1].src).toBe(""); images[1].finish(); await flush();
    expect(ready()).toBeUndefined();
});

it.each(["mosaic", "blur"] as const)("keeps an opaque %s stroke while its pixels are unavailable", async (effectType) => {
    dispose = render(() => <svg>{renderStickerEffectOverlay({ effectType, maskId: "protected",
        points: [{ x: 10, y: 10 }, { x: 80, y: 10 }], brushWidth: 20, strength: 8,
        imageSrc: "data:source", x: 0, y: 0, w: 200, h: 100, draft: true })}</svg>, document.body);
    const path = () => document.querySelector("path")!;
    expect(path().getAttribute("stroke")).toBe("#808a96");
    expect(path().closest("g")?.getAttribute("opacity")).toBe("1");
    images[0].fail(); await flush();
    expect(path().getAttribute("stroke")).toBe("#808a96");
});
