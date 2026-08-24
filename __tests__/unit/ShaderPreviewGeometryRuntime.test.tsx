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

});

