// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

import { ShaderPreview } from "../../src/components/ShaderPreview";
import type { ShaderRenderer } from "../../src/components/ShaderRenderer";
import { shaderCache } from "../../src/services/shaderCache";

class DeferredImage {
    static instances: DeferredImage[] = [];

    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = "";
    width = 100;
    height = 100;
    naturalWidth = 100;
    naturalHeight = 100;
    private source = "";

    constructor() {
        DeferredImage.instances.push(this);
    }

    set src(value: string) {
        this.source = value;
    }

    get src(): string {
        return this.source;
    }

    resolve(): void {
        this.onload?.();
    }
}

const createRendererDouble = (canvas: HTMLCanvasElement) => ({
    setTextureLoadHandler: vi.fn(),
    loadTexture: vi.fn(),
    setUniform: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    getCanvas: () => canvas,
    isReady: () => false,
});

describe("ShaderPreview renderer generations", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        DeferredImage.instances = [];
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("does not let a delayed input image write into a replacement renderer", async () => {
        vi.stubGlobal("Image", DeferredImage);
        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        const renderers = new Map<string, ReturnType<typeof createRendererDouble>>();
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((artId, _unitId, canvas) => {
            const existing = renderers.get(artId);
            if (existing) return existing as unknown as ShaderRenderer;
            const created = createRendererDouble(canvas);
            renderers.set(artId, created);
            return created as unknown as ShaderRenderer;
        });

        const host = document.createElement("div");
        document.body.append(host);
        let replaceShader!: () => void;
        const dispose = render(() => {
            const [state, setState] = createSignal({ artId: "art-a", inputSrc: "input-a" });
            replaceShader = () => setState({ artId: "art-b", inputSrc: "input-b" });
            return (
                <ShaderPreview
                    unitId="restored-unit"
                    artId={state().artId}
                    params={{}}
                    inputImageSrc={state().inputSrc}
                    width={200}
                    height={100}
                />
            );
        }, host);

        await Promise.resolve();
        const inputA = DeferredImage.instances.find((image) => image.src === "input-a");
        expect(inputA).toBeTruthy();

        replaceShader();
        await Promise.resolve();
        const inputB = DeferredImage.instances.find((image) => image.src === "input-b");
        expect(inputB).toBeTruthy();

        inputA?.resolve();
        expect(renderers.get("art-a")?.loadTexture).not.toHaveBeenCalled();
        expect(renderers.get("art-b")?.loadTexture).not.toHaveBeenCalled();

        inputB?.resolve();
        expect(renderers.get("art-b")?.loadTexture).toHaveBeenCalledWith("input", inputB);

        dispose();
    });

    it("reapplies unchanged restored uniforms and image params after a renderer rebuild", async () => {
        vi.stubGlobal("Image", DeferredImage);
        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        const renderers = new Map<string, ReturnType<typeof createRendererDouble>>();
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((artId, _unitId, canvas) => {
            const created = createRendererDouble(canvas);
            renderers.set(artId, created);
            return created as unknown as ShaderRenderer;
        });

        const host = document.createElement("div");
        document.body.append(host);
        const restoredParams = { strength: 18, mask: "mask-unit" };
        let rebuildRenderer!: () => void;
        const dispose = render(() => {
            const [artId, setArtId] = createSignal("art-a");
            rebuildRenderer = () => setArtId("art-b");
            return (
                <ShaderPreview
                    unitId="restored-unit"
                    artId={artId()}
                    params={restoredParams}
                    holdFallbackPreview
                    fallbackPreviewSrc="data:image/png;base64,PERSISTED"
                    resolveUnitImage={(unitId) => unitId === "mask-unit" ? "mask-src" : undefined}
                    width={200}
                    height={100}
                />
            );
        }, host);

        await Promise.resolve();
        const firstMaskLoad = DeferredImage.instances.find((image) => image.src === "mask-src");
        expect(renderers.get("art-a")?.setUniform).toHaveBeenCalledWith("strength", 18);
        expect(firstMaskLoad).toBeTruthy();

        rebuildRenderer();
        await Promise.resolve();
        const maskLoads = DeferredImage.instances.filter((image) => image.src === "mask-src");
        expect(maskLoads).toHaveLength(2);
        expect(renderers.get("art-b")?.setUniform).toHaveBeenCalledWith("strength", 18);

        firstMaskLoad?.resolve();
        expect(renderers.get("art-b")?.loadTexture).not.toHaveBeenCalled();

        maskLoads[1]?.resolve();
        expect(renderers.get("art-b")?.loadTexture).toHaveBeenCalledWith("mask", maskLoads[1]);

        dispose();
    });

    it("ignores delayed parameter images after the preview is disposed", async () => {
        vi.stubGlobal("Image", DeferredImage);
        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        const renderer = createRendererDouble(document.createElement("canvas"));
        vi.spyOn(shaderCache, "getRenderer").mockReturnValue(renderer as unknown as ShaderRenderer);

        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <ShaderPreview
                    unitId="disposed-unit"
                    artId="art-a"
                    params={{ mask: "mask-src" }}
                    width={200}
                    height={100}
                />
            ),
            host,
        );

        await Promise.resolve();
        const maskLoad = DeferredImage.instances.find((image) => image.src === "mask-src");
        expect(maskLoad).toBeTruthy();

        dispose();
        maskLoad?.resolve();

        expect(renderer.loadTexture).not.toHaveBeenCalled();
        expect(renderer.render).not.toHaveBeenCalled();
    });

    it("ignores a superseded parameter image on the same renderer", async () => {
        vi.stubGlobal("Image", DeferredImage);
        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        const renderer = createRendererDouble(document.createElement("canvas"));
        vi.spyOn(shaderCache, "getRenderer").mockReturnValue(renderer as unknown as ShaderRenderer);

        const host = document.createElement("div");
        document.body.append(host);
        let replaceMask!: () => void;
        const dispose = render(() => {
            const [mask, setMask] = createSignal("mask-a");
            replaceMask = () => setMask("mask-b");
            return (
                <ShaderPreview
                    unitId="updated-param-unit"
                    artId="art-a"
                    params={{ mask: mask() }}
                    width={200}
                    height={100}
                />
            );
        }, host);

        await Promise.resolve();
        const maskA = DeferredImage.instances.find((image) => image.src === "mask-a");
        expect(maskA).toBeTruthy();

        replaceMask();
        await Promise.resolve();
        const maskB = DeferredImage.instances.find((image) => image.src === "mask-b");
        expect(maskB).toBeTruthy();

        maskA?.resolve();
        expect(renderer.loadTexture).not.toHaveBeenCalled();

        maskB?.resolve();
        expect(renderer.loadTexture).toHaveBeenCalledWith("mask", maskB);

        dispose();
    });
});
