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
    it("recovers a restored file-backed fallback preview through readImageFromPath when the direct image load fails", async () => {
        (window as Window & { __TAURI_INTERNALS__?: { convertFileSrc: (path: string) => string } }).__TAURI_INTERNALS__ = {
            convertFileSrc: (path: string) => path,
        };
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

