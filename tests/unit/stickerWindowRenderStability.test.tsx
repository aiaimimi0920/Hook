// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { UnitVisualOverlays } from "../../src/features/workspace/components/UnitVisualOverlays";
import { createUnitImageModel } from "../../src/features/workspace/components/unitImageModel";
import { graphStore } from "../../src/features/workspace/state/graphStore";
import { acquireStickerBlurTexture } from "../../src/features/stickers/services/stickerBlurTexture";
import { buildMosaicTextureDataUrl } from "../../src/features/stickers/services/stickerEffects";
import { clearAllSyncImageCaches, setBakedSyncPreviewCacheEntry } from "../../src/features/workspace/services/syncImageCache";
import type { Unit } from "../../src/features/workspace/types/unit";

vi.mock("../../src/features/workspace/services/syncService", () => ({ syncService: {
    performWorkflowSync: vi.fn().mockResolvedValue(undefined), updateBackendRects: vi.fn().mockResolvedValue(undefined),
} }));
vi.mock("../../src/features/stickers/services/stickerBlurTexture", () => ({ acquireStickerBlurTexture: vi.fn() }));
vi.mock("../../src/features/stickers/services/stickerEffects", async (original) => ({
    ...await original<typeof import("../../src/features/stickers/services/stickerEffects")>(),
    buildMosaicTextureDataUrl: vi.fn(() => "data:image/png;base64,MOSAIC"),
}));

let dispose: (() => void) | undefined;
afterEach(() => {
    dispose?.(); dispose = undefined;
    graphStore.setUnits([]); clearAllSyncImageCaches();
    document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.clearAllMocks();
});

// Exercise real store, viewport, annotation list and effects, not a mocked annotation layer.
it.each(["blur", "mosaic"] as const)("retains A/B %s nodes and decoded resources through 40 window transitions", async (type) => {
    const decode = vi.fn(() => Promise.resolve());
    vi.stubGlobal("Image", class {
        src = ""; naturalWidth = 400; naturalHeight = 300; decode = decode;
        removeAttribute() { this.src = ""; }
    });
    const release = vi.fn();
    vi.mocked(acquireStickerBlurTexture).mockReturnValue({ url: "blob:ready", ready: Promise.resolve("blob:ready"), release });
    const fixture = (id: string): Unit => ({
        id, type: "sticker", x: 0, y: 0, w: 400, h: 300, params: {}, inputs: [], outputs: [],
        data: { src: "data:image/png;base64,BASE", annotationState: { serialCounter: 1, elements: [{
            id: "shared-business-id", type, zIndex: 1, x: 100, y: 50, w: 200, h: 100,
            points: [{ x: 120, y: 100 }, { x: 280, y: 100 }], brushWidth: 80, strength: 12,
            style: { color: "#ffffff", width: 80 },
        }] } },
    });
    graphStore.setUnits([fixture("a"), fixture("b")]);
    const host = document.createElement("div"); document.body.append(host);
    const View = (props: { id: string }) => {
        const unit = () => graphStore.units.find((item) => item.id === props.id)!;
        const model = createUnitImageModel({ unit, params: () => ({}), connectedLinks: () => [],
            resolveUnitImage: () => undefined, inputs: () => [], isShaderArt: () => false,
            artId: () => undefined, shaderInputSrc: () => "", shaderReferenceSrc: () => undefined });
        return <div data-unit={props.id}><UnitVisualOverlays unit={unit()} isArt={false}
            isMinified={!!unit().data.minified} isSelected={false} isCleanView={true}
            minifiedAnnotationViewport={model.minifiedAnnotationViewport()} displaySrc={model.displaySrc()} artErrorMessage="" /></div>;
    };
    dispose = render(() => <><View id="a" /><View id="b" /></>, host);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const nodes = [...host.querySelectorAll("pattern, pattern image, path[stroke]")];
    expect(host.querySelectorAll("pattern")).toHaveLength(2);
    const hrefs = [...host.querySelectorAll("pattern image")].map((node) => node.getAttribute("href"));
    const counts = [decode.mock.calls.length, vi.mocked(acquireStickerBlurTexture).mock.calls.length,
        vi.mocked(buildMosaicTextureDataUrl).mock.calls.length];
    const receiver = graphStore.units[1].data.annotationState;
    for (let i = 0; i < 40; i++) {
        const mini = i % 2 === 0;
        graphStore.actions.updateStickerWindowState("a", { x: 0, y: 0, w: mini ? 100 : 400, h: mini ? 100 : 300 },
            { minified: mini, savedRect: { x: 0, y: 0, w: 400, h: 300 }, cropOffset: { x: 150, y: 50 } });
        setBakedSyncPreviewCacheEntry("a", { signature: `unrelated-${i}`, src: `data:cache-${i}` });
        await Promise.resolve();
        const currentNodes = [...host.querySelectorAll("pattern, pattern image, path[stroke]")];
        expect(currentNodes).toHaveLength(nodes.length);
        currentNodes.forEach((node, index) => expect(node).toBe(nodes[index]));
        expect([...host.querySelectorAll("pattern image")].map((node) => node.getAttribute("href"))).toEqual(hrefs);
        for (const node of host.querySelectorAll<HTMLElement>(".sticker-annotation-layer-viewport")) {
            expect(node.style.display).not.toBe("none"); expect(node.style.width).toBe("400px");
        }
        expect(graphStore.units[1].data.annotationState).toBe(receiver);
        expect([decode.mock.calls.length, vi.mocked(acquireStickerBlurTexture).mock.calls.length,
            vi.mocked(buildMosaicTextureDataUrl).mock.calls.length]).toEqual(counts);
        expect(release).not.toHaveBeenCalled();
    }
});
