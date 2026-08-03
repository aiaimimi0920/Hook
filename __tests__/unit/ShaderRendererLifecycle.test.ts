// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { ShaderRenderer } from "../../src/components/ShaderRenderer";

class DeferredImage {
    static instances: DeferredImage[] = [];

    onload: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    crossOrigin = "";
    width = 64;
    height = 64;
    naturalWidth = 64;
    naturalHeight = 64;
    src = "";

    constructor() {
        DeferredImage.instances.push(this);
    }

    resolve(): void {
        this.onload?.();
    }
}

describe("ShaderRenderer lifecycle", () => {
    afterEach(() => {
        DeferredImage.instances = [];
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("ignores delayed response textures after disposal and releases resources only once", () => {
        vi.stubGlobal("Image", DeferredImage);
        const gl = {
            TEXTURE_2D: 0x0DE1,
            RGBA: 0x1908,
            UNSIGNED_BYTE: 0x1401,
            TEXTURE_WRAP_S: 0x2802,
            TEXTURE_WRAP_T: 0x2803,
            CLAMP_TO_EDGE: 0x812F,
            TEXTURE_MIN_FILTER: 0x2801,
            TEXTURE_MAG_FILTER: 0x2800,
            LINEAR: 0x2601,
            drawingBufferWidth: 64,
            drawingBufferHeight: 64,
            createTexture: vi.fn(() => ({ texture: true })),
            bindTexture: vi.fn(),
            texImage2D: vi.fn(),
            texParameteri: vi.fn(),
            viewport: vi.fn(),
            deleteTexture: vi.fn(),
            deleteProgram: vi.fn(),
            deleteVertexArray: vi.fn(),
            deleteBuffer: vi.fn(),
        };
        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getContext").mockImplementation(
            () => gl as unknown as WebGL2RenderingContext,
        );
        const renderer = new ShaderRenderer(canvas);
        expect(canvas.getContext).toHaveBeenCalledWith("webgl2", expect.objectContaining({
            preserveDrawingBuffer: false,
        }));
        const textureLoadHandler = vi.fn();
        renderer.setTextureLoadHandler(textureLoadHandler);
        renderer.loadTextureFromSrc("lut", "data:image/png;base64,LUT");
        renderer.loadTexture("input", document.createElement("canvas"));

        expect(DeferredImage.instances).toHaveLength(1);
        expect(gl.createTexture).toHaveBeenCalledTimes(1);

        renderer.dispose();
        renderer.dispose();
        DeferredImage.instances[0]?.resolve();

        expect(gl.createTexture).toHaveBeenCalledTimes(1);
        expect(gl.texImage2D).toHaveBeenCalledTimes(1);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
        expect(textureLoadHandler).not.toHaveBeenCalled();
        expect(renderer.isReady()).toBe(false);
    });
});
