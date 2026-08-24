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

});

