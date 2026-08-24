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

