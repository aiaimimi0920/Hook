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

});

