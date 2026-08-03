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

    it("releases failed shader and program objects during compilation and linking", () => {
        const createCompileContext = (linkSucceeds: boolean) => {
            const vertexShader = { kind: "vertex" };
            const fragmentShader = { kind: "fragment" };
            const program = { kind: "program" };
            return {
                VERTEX_SHADER: 0x8B31,
                FRAGMENT_SHADER: 0x8B30,
                COMPILE_STATUS: 0x8B81,
                LINK_STATUS: 0x8B82,
                createShader: vi.fn((type: number) => type === 0x8B31 ? vertexShader : fragmentShader),
                shaderSource: vi.fn(),
                compileShader: vi.fn(),
                getShaderParameter: vi.fn(() => true),
                getShaderInfoLog: vi.fn(() => ""),
                deleteShader: vi.fn(),
                createProgram: vi.fn(() => program),
                attachShader: vi.fn(),
                linkProgram: vi.fn(),
                getProgramParameter: vi.fn(() => linkSucceeds),
                getProgramInfoLog: vi.fn(() => "link failed"),
                deleteProgram: vi.fn(),
                deleteTexture: vi.fn(),
                deleteVertexArray: vi.fn(),
                deleteBuffer: vi.fn(),
            };
        };

        const linkFailureGl = createCompileContext(false);
        const linkFailureCanvas = document.createElement("canvas");
        vi.spyOn(linkFailureCanvas, "getContext").mockImplementation(
            () => linkFailureGl as unknown as WebGL2RenderingContext,
        );
        const linkFailureRenderer = new ShaderRenderer(linkFailureCanvas);

        expect(linkFailureRenderer.initFromShaderResponse({
            type: "shader",
            vertex_shader: "vertex",
            fragment_shader: "fragment",
            uniforms: {},
            success: true,
        })).toBe(false);
        expect(linkFailureGl.deleteShader).toHaveBeenCalledTimes(2);
        expect(linkFailureGl.deleteProgram).toHaveBeenCalledTimes(1);

        const compileFailureGl = createCompileContext(true);
        compileFailureGl.getShaderParameter.mockReturnValue(false);
        const compileFailureCanvas = document.createElement("canvas");
        vi.spyOn(compileFailureCanvas, "getContext").mockImplementation(
            () => compileFailureGl as unknown as WebGL2RenderingContext,
        );
        const compileFailureRenderer = new ShaderRenderer(compileFailureCanvas);

        expect(compileFailureRenderer.initFromShaderResponse({
            type: "shader",
            vertex_shader: "vertex",
            fragment_shader: "fragment",
            uniforms: {},
            success: true,
        })).toBe(false);
        expect(compileFailureGl.deleteShader).toHaveBeenCalledTimes(2);
        expect(compileFailureGl.createProgram).not.toHaveBeenCalled();
    });

    it("releases removed optional textures immediately instead of retaining them until renderer disposal", () => {
        const textures = [{ id: 1 }, { id: 2 }];
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
            createTexture: vi.fn(() => textures.shift() ?? { id: 3 }),
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
        const source = document.createElement("canvas");
        source.width = 64;
        source.height = 64;

        renderer.loadTexture("mask", source);
        renderer.removeTexture("mask");
        renderer.loadTexture("replacement", source);

        expect(gl.createTexture).toHaveBeenCalledTimes(2);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(1);

        renderer.dispose();
        expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    });
});
