// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

import { ShaderPreview } from "../../src/components/ShaderPreview";
import { shaderCache } from "../../src/services/shaderCache";

describe("ShaderPreview runtime layout", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("contain-fits a square shader result inside a wider node instead of stretching it full width", async () => {
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 100;
            height = 100;
            naturalWidth = 100;
            naturalHeight = 100;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }

        vi.stubGlobal("Image", FakeImage);

        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: (_name: string, image: { width: number; height: number }) => {
                canvas.width = image.width;
                canvas.height = image.height;
            },
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => true,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <ShaderPreview
                    unitId="shader-unit"
                    artId="color-transfer"
                    params={{}}
                    inputImageSrc="data:image/png;base64,INPUT"
                    width={200}
                    height={100}
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        const canvas = host.querySelector("canvas");
        expect(canvas).toBeInstanceOf(HTMLCanvasElement);
        expect((canvas as HTMLCanvasElement).width).toBe(100);
        expect((canvas as HTMLCanvasElement).height).toBe(100);
        expect((canvas as HTMLCanvasElement).style.width).toBe("100px");
        expect((canvas as HTMLCanvasElement).style.height).toBe("100px");
        expect((canvas as HTMLCanvasElement).style.left).toBe("50px");
        expect((canvas as HTMLCanvasElement).style.top).toBe("0px");

        dispose();
    });

    it("keeps the shader canvas at source resolution when the node frame changes so minify/restore does not clear the rendered result", async () => {
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 100;
            height = 100;
            naturalWidth = 100;
            naturalHeight = 100;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }

        vi.stubGlobal("Image", FakeImage);

        const renderCalls: Array<{ canvasWidth: number; canvasHeight: number }> = [];

        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: (_name: string, image: { width: number; height: number }) => {
                canvas.width = image.width;
                canvas.height = image.height;
            },
            render: () => {
                renderCalls.push({
                    canvasWidth: canvas.width,
                    canvasHeight: canvas.height,
                });
            },
            getCanvas: () => canvas,
            isReady: () => true,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        let setFrame!: (next: { width: number; height: number }) => void;
        const dispose = render(() => {
            const [frame, updateFrame] = createSignal({ width: 200, height: 100 });
            setFrame = updateFrame;
            return (
                <ShaderPreview
                    unitId="shader-resize-unit"
                    artId="color-transfer"
                    params={{}}
                    inputImageSrc="data:image/png;base64,INPUT"
                    width={frame().width}
                    height={frame().height}
                />
            );
        }, host);

        await Promise.resolve();
        await Promise.resolve();

        const canvas = host.querySelector("canvas");
        expect(canvas).toBeInstanceOf(HTMLCanvasElement);
        expect((canvas as HTMLCanvasElement).width).toBe(100);
        expect((canvas as HTMLCanvasElement).height).toBe(100);
        expect((canvas as HTMLCanvasElement).style.left).toBe("50px");

        setFrame({ width: 100, height: 100 });
        await Promise.resolve();
        await Promise.resolve();

        expect((canvas as HTMLCanvasElement).width).toBe(100);
        expect((canvas as HTMLCanvasElement).height).toBe(100);
        expect((canvas as HTMLCanvasElement).style.left).toBe("0px");
        expect((canvas as HTMLCanvasElement).style.width).toBe("100px");
        expect(renderCalls.length).toBeGreaterThan(0);

        dispose();
    });

    it("re-applies restored numeric shader params after the renderer becomes ready on mount", async () => {
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 100;
            height = 100;
            naturalWidth = 100;
            naturalHeight = 100;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }

        vi.stubGlobal("Image", FakeImage);

        const setUniform = vi.fn();

        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: (_name: string, image: { width: number; height: number }) => {
                canvas.width = image.width;
                canvas.height = image.height;
            },
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => true,
            setUniform,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <ShaderPreview
                    unitId="shader-restored-unit"
                    artId="color-transfer"
                    params={{ strength: 18, gamma: 1.2, __expanded: true }}
                    inputImageSrc="data:image/png;base64,INPUT"
                    width={200}
                    height={100}
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        expect(setUniform).toHaveBeenCalledWith("strength", 18);
        expect(setUniform).toHaveBeenCalledWith("gamma", 1.2);
        expect(setUniform).not.toHaveBeenCalledWith("__expanded", expect.anything());

        dispose();
    });

    it("shows the persisted shader preview image while a restored shader node has not re-rendered yet", async () => {
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 100;
            height = 100;
            naturalWidth = 100;
            naturalHeight = 100;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }

        vi.stubGlobal("Image", FakeImage);

        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: (_name: string, image: { width: number; height: number }) => {
                canvas.width = image.width;
                canvas.height = image.height;
            },
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => false,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <ShaderPreview
                    unitId="shader-restored-preview-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    inputImageSrc="data:image/png;base64,INPUT"
                    width={200}
                    height={100}
                    {...({ fallbackPreviewSrc: "data:image/png;base64,PERSISTED" } as any)}
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        const fallback = host.querySelector('img[data-shader-fallback-preview="true"]');
        expect(fallback).toBeInstanceOf(HTMLImageElement);
        expect((fallback as HTMLImageElement).getAttribute("src")).toBe("data:image/png;base64,PERSISTED");

        dispose();
    });

    it("contain-fits a persisted shader fallback preview using its own intrinsic size when no live input image has loaded yet", async () => {
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 100;
            height = 100;
            naturalWidth = 100;
            naturalHeight = 100;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }

        vi.stubGlobal("Image", FakeImage);

        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: (_name: string, image: { width: number; height: number }) => {
                canvas.width = image.width;
                canvas.height = image.height;
            },
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => false,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <ShaderPreview
                    unitId="shader-fallback-layout-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    width={200}
                    height={100}
                    {...({ fallbackPreviewSrc: "data:image/png;base64,PERSISTED" } as any)}
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        const fallback = host.querySelector('img[data-shader-fallback-preview="true"]') as HTMLImageElement | null;
        expect(fallback).toBeInstanceOf(HTMLImageElement);
        Object.defineProperty(fallback!, "naturalWidth", { value: 100, configurable: true });
        Object.defineProperty(fallback!, "naturalHeight", { value: 100, configurable: true });
        fallback!.dispatchEvent(new Event("load"));
        await Promise.resolve();
        expect(fallback?.style.width).toBe("100px");
        expect(fallback?.style.height).toBe("100px");
        expect(fallback?.style.left).toBe("50px");
        expect(fallback?.style.top).toBe("0px");

        dispose();
    });

    it("does not remount the fallback preview when only the persisted preview src updates after a live shader render", async () => {
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 100;
            height = 100;
            naturalWidth = 100;
            naturalHeight = 100;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }

        vi.stubGlobal("Image", FakeImage);

        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: (_name: string, image: { width: number; height: number }) => {
                canvas.width = image.width;
                canvas.height = image.height;
            },
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => true,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        let setFallbackPreviewSrc!: (next: string | undefined) => void;
        const dispose = render(() => {
            const [fallbackPreviewSrc, updateFallbackPreviewSrc] = createSignal<string | undefined>(undefined);
            setFallbackPreviewSrc = updateFallbackPreviewSrc;
            return (
                <ShaderPreview
                    unitId="shader-live-preview-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    inputImageSrc="data:image/png;base64,INPUT"
                    fallbackPreviewSrc={fallbackPreviewSrc()}
                    width={200}
                    height={100}
                />
            );
        }, host);

        await Promise.resolve();
        await Promise.resolve();

        expect(host.querySelector('img[data-shader-fallback-preview="true"]')).toBeNull();

        setFallbackPreviewSrc("data:image/png;base64,UPDATED_PERSISTED");
        await Promise.resolve();
        await Promise.resolve();

        expect(host.querySelector('img[data-shader-fallback-preview="true"]')).toBeNull();
        const canvas = host.querySelector("canvas") as HTMLCanvasElement | null;
        expect(canvas?.style.width).toBe("100px");
        expect(canvas?.style.height).toBe("100px");
        expect(canvas?.style.left).toBe("50px");

        dispose();
    });

    it("keeps the live shader preview mounted when unrelated graph-unit or downstream-link changes re-evaluate the same input source", async () => {
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 100;
            height = 100;
            naturalWidth = 100;
            naturalHeight = 100;

            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }

        vi.stubGlobal("Image", FakeImage);

        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: (_name: string, image: { width: number; height: number }) => {
                canvas.width = image.width;
                canvas.height = image.height;
            },
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => true,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        let setGraphUnitRevision!: (next: number) => void;
        let setGraphLinkRevision!: (next: number) => void;
        const dispose = render(() => {
            const [graphUnitRevision, updateGraphUnitRevision] = createSignal(0);
            const [graphLinkRevision, updateGraphLinkRevision] = createSignal(0);
            setGraphUnitRevision = updateGraphUnitRevision;
            setGraphLinkRevision = updateGraphLinkRevision;

            return (
                <ShaderPreview
                    unitId="shader-graph-reactivity-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    inputImageSrc={(() => {
                        void graphUnitRevision();
                        void graphLinkRevision();
                        return "data:image/png;base64,INPUT";
                    })()}
                    fallbackPreviewSrc="data:image/png;base64,PERSISTED"
                    width={200}
                    height={100}
                />
            );
        }, host);

        await Promise.resolve();
        await Promise.resolve();

        expect(host.querySelector('img[data-shader-fallback-preview="true"]')).toBeNull();
        const canvas = host.querySelector("canvas") as HTMLCanvasElement | null;
        expect(canvas?.style.width).toBe("100px");
        expect(canvas?.style.height).toBe("100px");
        expect(canvas?.style.left).toBe("50px");

        setGraphUnitRevision(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(host.querySelector('img[data-shader-fallback-preview="true"]')).toBeNull();
        expect(canvas?.style.width).toBe("100px");
        expect(canvas?.style.height).toBe("100px");
        expect(canvas?.style.left).toBe("50px");

        setGraphLinkRevision(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(host.querySelector('img[data-shader-fallback-preview="true"]')).toBeNull();
        expect(canvas?.style.width).toBe("100px");
        expect(canvas?.style.height).toBe("100px");
        expect(canvas?.style.left).toBe("50px");

        dispose();
    });
});
