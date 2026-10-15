// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { StickerEffectDraftOverlay, renderStickerEffectOverlay } from "../../src/components/StickerEffectOverlay";
import { acquireStickerBlurTexture } from "../../src/services/stickerBlurTexture";
import { buildMosaicTextureDataUrl } from "../../src/services/stickerEffects";

vi.mock("../../src/services/stickerBlurTexture", () => ({ acquireStickerBlurTexture: vi.fn() }));
// Resource-identity tests keep decoding immediate; delayed/failed loads have their own runtime suite.
vi.mock("../../src/components/decodedImageSource", () => ({ createDecodedImageSource: (source: () => string) => source }));
vi.mock("../../src/services/stickerEffects", () => ({
    BLUR_EFFECT_OVERLAY_FILL: "rgba(255,255,255,0.08)", buildMosaicTextureDataUrl: vi.fn(() => "data:mosaic"),
}));

describe("blur draft raster presentation", () => {
    let dispose: (() => void) | undefined;
    afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); });

    it.each(["mosaic", "blur"] as const)("isolates %s definitions across propagated copies and concurrent drafts", (effectType) => {
        vi.mocked(acquireStickerBlurTexture).mockReturnValue({ url: null, ready: Promise.resolve(null), release: vi.fn() });
        const [sourceVisible, setSourceVisible] = createSignal(true);
        const [sourceMounted, setSourceMounted] = createSignal(true);
        const host = document.createElement("div"); document.body.append(host);
        const committed = () => renderStickerEffectOverlay({ effectType, points: [{ x: 10, y: 20 }, { x: 90, y: 40 }],
            brushWidth: 30, strength: 8, imageSrc: "data:source", stickerWidth: 400, stickerHeight: 300,
            x: -5, y: 5, w: 110, h: 50, maskId: "same-propagated-annotation" });
        const draft = () => <StickerEffectDraftOverlay effectType={effectType} pathData={() => "M 10 20 L 90 40"}
            brushWidth={30} strength={8} imageSrc="data:source" stickerWidth={400} stickerHeight={300} />;
        dispose = render(() => <>
            <Show when={sourceMounted()}><svg style={{ display: sourceVisible() ? "block" : "none" }}>{committed()}</svg></Show>
            <svg data-receiver>{committed()}</svg><svg>{draft()}</svg><svg>{draft()}</svg>
        </>, host);
        const assertLocalReferences = () => {
            const ids = [...host.querySelectorAll("[id]")].map((element) => element.id);
            expect(new Set(ids).size).toBe(ids.length);
            for (const svg of host.querySelectorAll("svg")) {
                for (const element of svg.querySelectorAll("[stroke], [filter]")) {
                    for (const name of ["stroke", "filter"]) {
                        const reference = /^url\(#(.+)\)$/.exec(element.getAttribute(name) ?? "");
                        if (reference) expect(document.getElementById(reference[1])?.closest("svg")).toBe(svg);
                    }
                }
            }
        };
        assertLocalReferences();
        const receiverPattern = host.querySelector("[data-receiver] pattern");
        setSourceVisible(false); assertLocalReferences();
        setSourceVisible(true); assertLocalReferences();
        setSourceMounted(false); assertLocalReferences();
        expect(host.querySelector("[data-receiver] pattern")).toBe(receiverPattern);
    });

    it("updates the path without filtering, reacquiring textures, or building mosaics", async () => {
        const release = vi.fn();
        vi.mocked(acquireStickerBlurTexture).mockReturnValue({ url: null, ready: Promise.resolve("blob:blur"), release });
        const [path, setPath] = createSignal("M 1 1 L 2 2");
        const host = document.createElement("div"); document.body.append(host);
        dispose = render(() => <svg><StickerEffectDraftOverlay effectType="blur" pathData={path}
            brushWidth={30} strength={8} imageSrc="data:source" stickerWidth={400} stickerHeight={300} /></svg>, host);
        await Promise.resolve();
        expect(host.querySelector("feGaussianBlur")).toBeNull();
        expect(host.querySelector("image")?.getAttribute("href")).toBe("blob:blur");
        expect(host.querySelector("image")?.hasAttribute("filter")).toBe(false);
        const pattern = host.querySelector("pattern");
        for (let i = 0; i < 200; i++) setPath(`M 1 1 L ${i} 20`);
        expect(host.querySelector("path")?.getAttribute("d")).toBe("M 1 1 L 199 20");
        expect(host.querySelector("pattern")).toBe(pattern);
        expect(acquireStickerBlurTexture).toHaveBeenCalledTimes(1);
        expect(buildMosaicTextureDataUrl).not.toHaveBeenCalled();
        dispose(); dispose = undefined;
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("releases stale source/strength work and keeps the SVG fallback on failure", async () => {
        let finishOld!: (url: string | null) => void;
        const releaseOld = vi.fn();
        vi.mocked(acquireStickerBlurTexture)
            .mockReturnValueOnce({ url: null, ready: new Promise((resolve) => { finishOld = resolve; }), release: releaseOld })
            .mockReturnValue({ url: null, ready: Promise.resolve(null), release: vi.fn() });
        const [source, setSource] = createSignal("data:first");
        const [strength, setStrength] = createSignal(8);
        const host = document.createElement("div"); document.body.append(host);
        dispose = render(() => <svg><StickerEffectDraftOverlay effectType="blur" pathData={() => "M 1 1 L 2 2"}
            brushWidth={30} strength={strength()} imageSrc={source()} stickerWidth={400} stickerHeight={300} /></svg>, host);
        setSource("data:second");
        finishOld("blob:stale");
        await Promise.resolve();
        expect(releaseOld).toHaveBeenCalledOnce();
        expect(host.querySelector("image")?.getAttribute("href")).toBe("data:second");
        expect(host.querySelector("feGaussianBlur")).not.toBeNull();
        expect(host.querySelector("filter")?.getAttribute("color-interpolation-filters")).toBe("sRGB");
        setStrength(15);
        expect(acquireStickerBlurTexture).toHaveBeenLastCalledWith("data:second", 400, 300, 15);
    });

    it("matches draft and committed opacity, geometry and ready texture without a fallback frame", () => {
        vi.mocked(acquireStickerBlurTexture).mockReturnValue({ url: "blob:blur", ready: Promise.resolve("blob:blur"), release: vi.fn() });
        const host = document.createElement("div"); document.body.append(host);
        dispose = render(() => <>
            <svg data-draft><StickerEffectDraftOverlay effectType="blur" pathData={() => "M 10 20 L 90 40"}
                brushWidth={30} strength={8} imageSrc="data:source" stickerWidth={400} stickerHeight={300} /></svg>
            <svg data-committed>{renderStickerEffectOverlay({ effectType: "blur", points: [{ x: 10, y: 20 }, { x: 90, y: 40 }],
                brushWidth: 30, strength: 8, imageSrc: "data:source", stickerWidth: 400, stickerHeight: 300,
                x: -5, y: 5, w: 110, h: 50, maskId: "committed" })}</svg>
        </>, host);
        for (const svg of host.querySelectorAll("svg")) {
            expect(svg.querySelector("g")?.getAttribute("opacity")).toBe("1");
            expect(svg.querySelector("path")?.getAttribute("d")).toBe("M 10 20 L 90 40");
            expect(svg.querySelector("path")?.getAttribute("stroke-width")).toBe("30");
            expect(svg.querySelector("image")?.getAttribute("href")).toBe("blob:blur");
            expect(svg.querySelector("filter")).toBeNull();
        }
    });
});
