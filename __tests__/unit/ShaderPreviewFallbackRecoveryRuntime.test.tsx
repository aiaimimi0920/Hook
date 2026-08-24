// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

import type { ShaderRenderer } from "../../src/components/ShaderRenderer";
import { ShaderPreview } from "../../src/components/ShaderPreview";
import { api } from "../../src/services/api";
import { shaderCache } from "../../src/services/shaderCache";

describe("ShaderPreview fallback recovery lifecycle", () => {
    afterEach(() => {
        delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("ignores file recovery after the fallback source changes or the preview is disposed", async () => {
        (window as Window & {
            __TAURI_INTERNALS__?: { convertFileSrc: (path: string) => string };
        }).__TAURI_INTERNALS__ = {
            convertFileSrc: (path: string) => `asset://localhost/${path.replace(/\\/g, "/")}`,
        };
        const deferredResolves: Array<(value: string) => void> = [];
        vi.spyOn(api, "readImageFromPath").mockImplementation(
            () => new Promise<string>((resolve) => deferredResolves.push(resolve)),
        );
        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: () => true,
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => false,
            setUniform: () => undefined,
        }) as unknown as ShaderRenderer);

        const host = document.createElement("div");
        document.body.append(host);
        const [fallbackSrc, setFallbackSrc] = createSignal("C:\\persisted\\old.png");
        const dispose = render(
            () => (
                <ShaderPreview
                    unitId="shader-stale-file-recovery"
                    artId="color-transfer"
                    params={{}}
                    fallbackPreviewSrc={fallbackSrc()}
                    width={200}
                    height={100}
                />
            ),
            host,
        );

        const currentFallback = () =>
            host.querySelector('img[data-shader-fallback-preview="true"]') as HTMLImageElement | null;
        currentFallback()?.dispatchEvent(new Event("error"));
        expect(deferredResolves).toHaveLength(1);

        setFallbackSrc("C:\\persisted\\new.png");
        await Promise.resolve();
        deferredResolves[0]?.("data:image/png;base64,STALE");
        await Promise.resolve();
        await Promise.resolve();

        expect(currentFallback()?.getAttribute("src")).toBe("asset://localhost/C:/persisted/new.png");
        currentFallback()?.dispatchEvent(new Event("error"));
        expect(deferredResolves).toHaveLength(2);

        dispose();
        deferredResolves[1]?.("data:image/png;base64,DISPOSED");
        await Promise.resolve();
        await Promise.resolve();
        expect(currentFallback()).toBeNull();
    });

    it("releases an oversized fallback without publishing its intrinsic dimensions", () => {
        vi.spyOn(shaderCache, "hasShaderCode").mockReturnValue(true);
        vi.spyOn(shaderCache, "disposeRenderer").mockImplementation(() => undefined);
        vi.spyOn(shaderCache, "getRenderer").mockImplementation((_artId, _unitId, canvas) => ({
            setTextureLoadHandler: () => undefined,
            loadTexture: () => true,
            render: () => undefined,
            getCanvas: () => canvas,
            isReady: () => false,
            setUniform: () => undefined,
        }) as unknown as ShaderRenderer);
        const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const onIntrinsicSizeChange = vi.fn();
        const host = document.createElement("div");
        document.body.append(host);
        const dispose = render(
            () => (
                <ShaderPreview
                    unitId="shader-oversized-fallback"
                    artId="color-transfer"
                    params={{}}
                    fallbackPreviewSrc="data:image/png;base64,OVERSIZED"
                    width={200}
                    height={100}
                    onIntrinsicSizeChange={onIntrinsicSizeChange}
                />
            ),
            host,
        );
        const fallback = host.querySelector(
            'img[data-shader-fallback-preview="true"]',
        ) as HTMLImageElement | null;
        expect(fallback).toBeInstanceOf(HTMLImageElement);
        Object.defineProperty(fallback, "naturalWidth", { configurable: true, value: 8192 });
        Object.defineProperty(fallback, "naturalHeight", { configurable: true, value: 4097 });

        fallback?.dispatchEvent(new Event("load"));

        expect(fallback?.hasAttribute("src")).toBe(false);
        expect(onIntrinsicSizeChange).not.toHaveBeenCalled();
        expect(warning).toHaveBeenCalledWith(
            "[ShaderPreview] Rejected fallback preview outside the shader image budget",
        );
        dispose();
    });
});
