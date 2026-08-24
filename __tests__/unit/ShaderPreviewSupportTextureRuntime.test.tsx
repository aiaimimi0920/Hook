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

});

