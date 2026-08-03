// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

import { ShaderPreview } from "../../src/components/ShaderPreview";
import { api } from "../../src/services/api";
import { shaderCache } from "../../src/services/shaderCache";

describe("ShaderPreview runtime layout", () => {
    afterEach(() => {
        vi.useRealTimers();
        delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
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

    it("coalesces rapid numeric parameter renders into one animation frame", async () => {
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

        const frameCallbacks: FrameRequestCallback[] = [];
        vi.stubGlobal("Image", FakeImage);
        vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        }));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        const renderShader = vi.fn();
        const setUniform = vi.fn();
        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: (_name: string, image: { width: number; height: number }) => {
                canvas.width = image.width;
                canvas.height = image.height;
            },
            render: renderShader,
            getCanvas: () => canvas,
            isReady: () => true,
            setUniform,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);
        let setParams!: (next: Record<string, unknown>) => void;
        const dispose = render(() => {
            const [params, updateParams] = createSignal<Record<string, unknown>>({ strength: 10 });
            setParams = updateParams;
            return (
                <ShaderPreview
                    unitId="shader-coalesced-unit"
                    artId="color-transfer"
                    params={params()}
                    inputImageSrc="data:image/png;base64,INPUT"
                    width={200}
                    height={100}
                />
            );
        }, host);

        await Promise.resolve();
        await Promise.resolve();
        renderShader.mockClear();
        setUniform.mockClear();

        setParams({ strength: 20 });
        await Promise.resolve();
        setParams({ strength: 30 });
        await Promise.resolve();

        expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(renderShader).not.toHaveBeenCalled();
        expect(setUniform).toHaveBeenLastCalledWith("strength", 30);

        frameCallbacks.shift()?.(16);
        expect(renderShader).toHaveBeenCalledTimes(1);

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

    it("keeps a restored shader node on its persisted preview while a background live rerender is preparing", async () => {
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

        const getRenderer = vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: (_name: string, image: { width: number; height: number }) => {
                canvas.width = image.width;
                canvas.height = image.height;
            },
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => true,
            canPresentOutput: () => true,
            hasVisibleContent: () => true,
            setUniform: () => undefined,
        }) as any);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);

        const host = document.createElement("div");
        document.body.append(host);

        let setHoldFallbackPreview!: (next: boolean) => void;
        const dispose = render(() => {
            const [holdFallbackPreview, updateHoldFallbackPreview] = createSignal(true);
            setHoldFallbackPreview = updateHoldFallbackPreview;
            return (
                <ShaderPreview
                    unitId="shader-restored-lock-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    holdFallbackPreview={holdFallbackPreview()}
                    fallbackPreviewSrc="data:image/png;base64,PERSISTED"
                    inputImageSrc="data:image/png;base64,INPUT"
                    width={200}
                    height={100}
                />
            );
        }, host);

        await Promise.resolve();
        await Promise.resolve();

        expect(getRenderer.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(host.querySelector('img[data-shader-fallback-preview="true"]')).toBeInstanceOf(HTMLImageElement);

        setHoldFallbackPreview(false);
        await Promise.resolve();
        await Promise.resolve();

        expect(getRenderer.mock.calls.length).toBeGreaterThanOrEqual(1);

        dispose();
    });

    it("reloads the same input image when restored fallback mode unlocks so the shader keeps its intrinsic placement instead of stretching to the full node frame", async () => {
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
            canPresentOutput: () => true,
            hasVisibleContent: () => true,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        let setHoldFallbackPreview!: (next: boolean) => void;
        const dispose = render(() => {
            const [holdFallbackPreview, updateHoldFallbackPreview] = createSignal(true);
            setHoldFallbackPreview = updateHoldFallbackPreview;
            return (
                <ShaderPreview
                    unitId="shader-unlock-size-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    holdFallbackPreview={holdFallbackPreview()}
                    fallbackPreviewSrc="data:image/png;base64,PERSISTED"
                    inputImageSrc="data:image/png;base64,INPUT"
                    width={200}
                    height={100}
                />
            );
        }, host);

        await Promise.resolve();
        await Promise.resolve();

        const canvas = host.querySelector("canvas") as HTMLCanvasElement | null;
        expect(canvas).toBeInstanceOf(HTMLCanvasElement);
        expect(canvas?.style.width).toBe("100px");
        expect(canvas?.style.height).toBe("100px");
        expect(canvas?.style.left).toBe("50px");

        setHoldFallbackPreview(false);
        await Promise.resolve();
        await Promise.resolve();

        expect(canvas?.style.width).toBe("100px");
        expect(canvas?.style.height).toBe("100px");
        expect(canvas?.style.left).toBe("50px");

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

    it("reports restored fallback preview intrinsic size so a restored minified shader node can rebuild the same viewport before live input reload finishes", async () => {
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

        const onIntrinsicSizeChange = vi.fn();

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
                    unitId="shader-restored-fallback-intrinsic-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    width={200}
                    height={100}
                    fallbackPreviewSrc="data:image/png;base64,PERSISTED"
                    onIntrinsicSizeChange={onIntrinsicSizeChange}
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

        expect(onIntrinsicSizeChange).toHaveBeenCalledWith({ w: 100, h: 100 });

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

    it("keeps showing the persisted fallback preview until async shader support textures finish loading", async () => {
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

        let textureLoadHandler: (() => void) | undefined;
        let inputLoaded = false;
        let asyncTextureReady = false;

        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: (handler?: () => void) => {
                textureLoadHandler = handler;
            },
            loadTexture: (name: string, image: { width: number; height: number }) => {
                if (name === "input") {
                    inputLoaded = true;
                    canvas.width = image.width;
                    canvas.height = image.height;
                }
            },
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => inputLoaded,
            canPresentOutput: () => inputLoaded && asyncTextureReady,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <ShaderPreview
                    unitId="shader-restored-lut-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    inputImageSrc="data:image/png;base64,INPUT"
                    fallbackPreviewSrc="data:image/png;base64,PERSISTED"
                    width={200}
                    height={100}
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        expect(host.querySelector('img[data-shader-fallback-preview="true"]')).toBeInstanceOf(HTMLImageElement);

        asyncTextureReady = true;
        textureLoadHandler?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(host.querySelector('img[data-shader-fallback-preview="true"]')).toBeNull();

        dispose();
    });

    it("keeps the restored fallback visible and retries contextual shader prefetch when the first shader response is missing support textures", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(0));
        (window as Window & { __TAURI_INTERNALS__?: { convertFileSrc: (path: string, protocol?: string) => string } }).__TAURI_INTERNALS__ = {
            convertFileSrc: (path: string) => path,
        };

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

        const incompleteShader = {
            type: "shader" as const,
            vertex_shader: "vs",
            fragment_shader: "fs",
            uniforms: {},
            textures: { lut: "" },
            success: true,
        };
        const completeShader = {
            ...incompleteShader,
            textures: { lut: "data:image/png;base64,LUT" },
        };

        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "prefetchShader").mockImplementation(async () =>
            Date.now() < 1000 ? incompleteShader : completeShader,
        );
        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        const getRenderer = vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: (_name: string, image: { width: number; height: number }) => {
                canvas.width = image.width;
                canvas.height = image.height;
            },
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => true,
            canPresentOutput: () => true,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <ShaderPreview
                    unitId="shader-retry-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    fallbackPreviewSrc="data:image/png;base64,PERSISTED"
                    inputImageSrc="data:image/png;base64,INPUT"
                    referenceImageSrc="data:image/png;base64,REFERENCE"
                    requiresReference
                    width={200}
                    height={100}
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        expect(getRenderer).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1200);
        await Promise.resolve();
        await Promise.resolve();

        expect(getRenderer).toHaveBeenCalledTimes(1);
        expect(host.querySelector('img[data-shader-fallback-preview="true"]')).toBeNull();

        dispose();
    });

    it("presents a ready restored shader without synchronously reading back the full framebuffer", async () => {
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

        const legacyVisibilityCheck = vi.fn(() => false);
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
            canPresentOutput: () => true,
            hasVisibleContent: legacyVisibilityCheck,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <ShaderPreview
                    unitId="shader-transparent-restore-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    inputImageSrc="data:image/png;base64,INPUT"
                    fallbackPreviewSrc="data:image/png;base64,PERSISTED"
                    width={200}
                    height={100}
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        expect(host.querySelector('img[data-shader-fallback-preview="true"]')).toBeNull();
        expect(legacyVisibilityCheck).not.toHaveBeenCalled();

        dispose();
    });

    it("exports a ready restored shader without a transparent-frame retry or framebuffer readback", async () => {
        vi.useFakeTimers();

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
        class FakeFileReader {
            result: string | ArrayBuffer | null = null;
            onloadend: (() => void) | null = null;

            readAsDataURL(_blob: Blob) {
                this.result = "data:image/png;base64,FRESH";
                queueMicrotask(() => this.onloadend?.());
            }
        }
        vi.stubGlobal("FileReader", FakeFileReader as unknown as typeof FileReader);

        const legacyVisibilityCheck = vi.fn(() => false);
        const rendered = vi.fn();

        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: (_name: string, image: { width: number; height: number }) => {
                canvas.width = image.width;
                canvas.height = image.height;
            },
            render: () => undefined,
            getCanvas: () => {
                (canvas as HTMLCanvasElement).toBlob = (callback: BlobCallback) => {
                    callback(new Blob(["fresh"], { type: "image/png" }));
                };
                return canvas;
            },
            isReady: () => true,
            canPresentOutput: () => true,
            hasVisibleContent: legacyVisibilityCheck,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        const dispose = render(
            () => (
                <ShaderPreview
                    unitId="shader-transparent-retry-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    holdFallbackPreview
                    fallbackPreviewSrc="data:image/png;base64,PERSISTED"
                    inputImageSrc="data:image/png;base64,INPUT"
                    width={200}
                    height={100}
                    onRendered={rendered}
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(120);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(rendered).toHaveBeenCalledTimes(1);
        expect(legacyVisibilityCheck).not.toHaveBeenCalled();

        dispose();
    });

    it("keeps full-resolution PNG preview encoding single-flight and publishes only the latest parameters", async () => {
        vi.useFakeTimers();

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

        class FakeFileReader {
            result: string | ArrayBuffer | null = null;
            onloadend: (() => void) | null = null;
            onerror: (() => void) | null = null;
            onabort: (() => void) | null = null;

            readAsDataURL(_blob: Blob) {
                this.result = "data:image/png;base64,LATEST";
                queueMicrotask(() => this.onloadend?.());
            }
        }

        vi.stubGlobal("Image", FakeImage);
        vi.stubGlobal("FileReader", FakeFileReader as unknown as typeof FileReader);

        const toBlobCallbacks: BlobCallback[] = [];
        let activeEncodes = 0;
        let maxActiveEncodes = 0;
        const rendered = vi.fn();

        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => {
            canvas.toBlob = (callback: BlobCallback) => {
                activeEncodes += 1;
                maxActiveEncodes = Math.max(maxActiveEncodes, activeEncodes);
                toBlobCallbacks.push((blob) => {
                    activeEncodes -= 1;
                    callback(blob);
                });
            };
            return {
                setTextureLoadHandler: () => undefined,
                loadTexture: (_name: string, image: { width: number; height: number }) => {
                    canvas.width = image.width;
                    canvas.height = image.height;
                },
                render: () => undefined,
                getCanvas: () => canvas,
                isReady: () => true,
                canPresentOutput: () => true,
                setUniform: () => undefined,
                removeTexture: () => undefined,
            } as any;
        });

        const host = document.createElement("div");
        document.body.append(host);

        let setStrength!: (value: number) => void;
        const dispose = render(() => {
            const [strength, updateStrength] = createSignal(10);
            setStrength = updateStrength;
            return (
                <ShaderPreview
                    unitId="shader-single-flight-export-unit"
                    artId="color-transfer"
                    params={{ strength: strength() }}
                    inputImageSrc="data:image/png;base64,INPUT"
                    width={200}
                    height={100}
                    onRendered={rendered}
                />
            );
        }, host);

        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(120);

        expect(toBlobCallbacks).toHaveLength(1);
        expect(activeEncodes).toBe(1);

        setStrength(20);
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(200);

        expect(toBlobCallbacks).toHaveLength(1);
        expect(maxActiveEncodes).toBe(1);

        toBlobCallbacks[0]?.(new Blob(["stale"], { type: "image/png" }));
        await Promise.resolve();

        expect(toBlobCallbacks).toHaveLength(2);
        expect(activeEncodes).toBe(1);
        expect(rendered).not.toHaveBeenCalled();

        toBlobCallbacks[1]?.(new Blob(["latest"], { type: "image/png" }));
        await Promise.resolve();
        await Promise.resolve();

        expect(maxActiveEncodes).toBe(1);
        expect(activeEncodes).toBe(0);
        expect(rendered).toHaveBeenCalledTimes(1);
        expect(rendered).toHaveBeenCalledWith("data:image/png;base64,LATEST");

        dispose();
    });

    it("recovers a restored file-backed fallback preview through readImageFromPath when the direct image load fails", async () => {
        vi.spyOn(api, "readImageFromPath").mockResolvedValue("data:image/png;base64,RECOVERED");

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
                    unitId="shader-restored-file-fallback-unit"
                    artId="color-transfer"
                    params={{ strength: 50 }}
                    fallbackPreviewSrc={"C:\\persisted\\preview.png"}
                    width={200}
                    height={100}
                />
            ),
            host,
        );

        await Promise.resolve();
        await Promise.resolve();

        const fallback = host.querySelector('img[data-shader-fallback-preview="true"]') as HTMLImageElement | null;
        expect(fallback).toBeInstanceOf(HTMLImageElement);
        fallback!.dispatchEvent(new Event("error"));
        await Promise.resolve();
        await Promise.resolve();

        expect(api.readImageFromPath).toHaveBeenCalledWith("C:\\persisted\\preview.png");
        expect(fallback?.getAttribute("src")).toBe("data:image/png;base64,RECOVERED");

        dispose();
    });

    it("ignores a stale contextual shader prefetch that resolves after the preview unmounts and remounts", async () => {
        (window as Window & { __TAURI_INTERNALS__?: { convertFileSrc: (path: string, protocol?: string) => string } }).__TAURI_INTERNALS__ = {
            convertFileSrc: (path: string) => path,
        };

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

        const deferredResolves: Array<(value: any) => void> = [];
        const completeShader = {
            type: "shader" as const,
            vertex_shader: "vs",
            fragment_shader: "fs",
            uniforms: {},
            textures: { lut: "data:image/png;base64,LUT" },
            success: true,
        };

        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "prefetchShader").mockImplementation(
            () =>
                new Promise((resolve) => {
                    deferredResolves.push(resolve);
                }),
        );
        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        const getRenderer = vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: () => undefined,
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => false,
            setUniform: () => undefined,
        }) as any);

        const host = document.createElement("div");
        document.body.append(host);

        const renderPreview = () =>
            render(
                () => (
                    <ShaderPreview
                        unitId="shader-stale-prefetch-unit"
                        artId="color-transfer"
                        params={{ strength: 50 }}
                        fallbackPreviewSrc="data:image/png;base64,PERSISTED"
                        inputImageSrc="data:image/png;base64,INPUT"
                        referenceImageSrc="data:image/png;base64,REFERENCE"
                        requiresReference
                        width={200}
                        height={100}
                    />
                ),
                host,
            );

        const disposeFirst = renderPreview();
        const firstCanvas = host.querySelector("canvas") as HTMLCanvasElement | null;
        expect(firstCanvas).toBeInstanceOf(HTMLCanvasElement);

        disposeFirst();

        const disposeSecond = renderPreview();
        const secondCanvas = host.querySelector("canvas") as HTMLCanvasElement | null;
        expect(secondCanvas).toBeInstanceOf(HTMLCanvasElement);
        expect(secondCanvas).not.toBe(firstCanvas);
        expect(deferredResolves).toHaveLength(2);

        // Each mount owns one contextual request. Resolving the unmounted
        // generation must not attach its renderer to the remounted canvas.
        deferredResolves[0]?.(completeShader);
        await Promise.resolve();
        await Promise.resolve();

        expect(getRenderer).not.toHaveBeenCalled();

        deferredResolves[1]?.(completeShader);
        await Promise.resolve();
        await Promise.resolve();

        expect(getRenderer).toHaveBeenCalledTimes(1);
        expect(getRenderer.mock.calls[0]?.[2]).toBe(secondCanvas);

        disposeSecond();
    });
});
