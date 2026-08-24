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

    it("rejects oversized textures and removes a stale texture instead of presenting it", () => {
        const textures = [{ id: 1 }, { id: 2 }];
        const gl = {
            MAX_TEXTURE_SIZE: 0x0D33,
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
            getParameter: vi.fn(() => 8192),
            createTexture: vi.fn(() => textures.shift() ?? null),
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

        expect(renderer.loadTexture("mask", source)).toBe(true);
        source.width = 8192;
        source.height = 4097;
        expect(renderer.loadTexture("mask", source)).toBe(false);

        expect(gl.createTexture).toHaveBeenCalledTimes(1);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
        expect(gl.texImage2D).toHaveBeenCalledTimes(1);
    });

    it("does not report a response texture as loaded when allocation fails", () => {
        vi.stubGlobal("Image", DeferredImage);
        const gl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            TEXTURE_2D: 0x0DE1,
            getParameter: vi.fn(() => 8192),
            createTexture: vi.fn(() => null),
            bindTexture: vi.fn(),
            texImage2D: vi.fn(),
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
        const textureLoadHandler = vi.fn();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        renderer.setTextureLoadHandler(textureLoadHandler);

        renderer.loadTextureFromSrc("lut", "data:image/png;base64,LUT");
        DeferredImage.instances[0]?.resolve();

        expect(gl.createTexture).toHaveBeenCalledTimes(1);
        expect(gl.bindTexture).not.toHaveBeenCalled();
        expect(gl.texImage2D).not.toHaveBeenCalled();
        expect(textureLoadHandler).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith("[ShaderRenderer] Failed to allocate texture 'lut'");
    });

    it("rejects shaders without the required position attribute and releases their GL objects", () => {
        const program = { kind: "program" };
        const vao = { kind: "vao" };
        const buffer = { kind: "buffer" };
        const gl = {
            VERTEX_SHADER: 0x8B31,
            FRAGMENT_SHADER: 0x8B30,
            COMPILE_STATUS: 0x8B81,
            LINK_STATUS: 0x8B82,
            ARRAY_BUFFER: 0x8892,
            STATIC_DRAW: 0x88E4,
            createShader: vi.fn(() => ({})),
            shaderSource: vi.fn(),
            compileShader: vi.fn(),
            getShaderParameter: vi.fn(() => true),
            getShaderInfoLog: vi.fn(() => ""),
            deleteShader: vi.fn(),
            createProgram: vi.fn(() => program),
            attachShader: vi.fn(),
            linkProgram: vi.fn(),
            getProgramParameter: vi.fn(() => true),
            getProgramInfoLog: vi.fn(() => ""),
            deleteProgram: vi.fn(),
            createVertexArray: vi.fn(() => vao),
            bindVertexArray: vi.fn(),
            deleteVertexArray: vi.fn(),
            createBuffer: vi.fn(() => buffer),
            bindBuffer: vi.fn(),
            bufferData: vi.fn(),
            deleteBuffer: vi.fn(),
            getAttribLocation: vi.fn(() => -1),
            enableVertexAttribArray: vi.fn(),
            deleteTexture: vi.fn(),
        };
        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getContext").mockImplementation(
            () => gl as unknown as WebGL2RenderingContext,
        );
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const renderer = new ShaderRenderer(canvas);

        expect(renderer.initFromShaderResponse({
            type: "shader",
            vertex_shader: "vertex",
            fragment_shader: "fragment",
            uniforms: {},
            success: true,
        })).toBe(false);

        expect(error).toHaveBeenCalledWith("Shader is missing the required a_position attribute");
        expect(gl.enableVertexAttribArray).not.toHaveBeenCalled();
        expect(gl.deleteProgram).toHaveBeenCalledWith(program);
        expect(gl.deleteVertexArray).toHaveBeenCalledWith(vao);
        expect(gl.deleteBuffer).toHaveBeenCalledWith(buffer);
    });

    it("rejects exhausted texture units and WebGL upload errors without retaining invalid textures", () => {
        const gl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
            NO_ERROR: 0,
            TEXTURE_2D: 0x0DE1,
            RGBA: 0x1908,
            UNSIGNED_BYTE: 0x1401,
            TEXTURE_WRAP_S: 0x2802,
            TEXTURE_WRAP_T: 0x2803,
            CLAMP_TO_EDGE: 0x812F,
            TEXTURE_MIN_FILTER: 0x2801,
            TEXTURE_MAG_FILTER: 0x2800,
            LINEAR: 0x2601,
            getParameter: vi.fn((parameter: number) => parameter === 0x0D33 ? 8192 : 1),
            getError: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0x0502),
            createTexture: vi.fn(() => ({ texture: true })),
            bindTexture: vi.fn(),
            texImage2D: vi.fn(),
            texParameteri: vi.fn(),
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
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        expect(renderer.loadTexture("first", source)).toBe(true);
        expect(renderer.loadTexture("second", source)).toBe(false);
        expect(renderer.loadTexture("first", source)).toBe(false);

        expect(gl.createTexture).toHaveBeenCalledTimes(1);
        expect(gl.texImage2D).toHaveBeenCalledTimes(2);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    });

    it("fails cleanly when shader vertex resources cannot be allocated", () => {
        const createRenderer = (vao: object | null, buffer: object | null) => {
            const gl = {
                VERTEX_SHADER: 0x8B31,
                FRAGMENT_SHADER: 0x8B30,
                COMPILE_STATUS: 0x8B81,
                LINK_STATUS: 0x8B82,
                ARRAY_BUFFER: 0x8892,
                STATIC_DRAW: 0x88E4,
                createShader: vi.fn(() => ({})),
                shaderSource: vi.fn(),
                compileShader: vi.fn(),
                getShaderParameter: vi.fn(() => true),
                getShaderInfoLog: vi.fn(() => ""),
                deleteShader: vi.fn(),
                createProgram: vi.fn(() => ({ program: true })),
                attachShader: vi.fn(),
                linkProgram: vi.fn(),
                getProgramParameter: vi.fn(() => true),
                getProgramInfoLog: vi.fn(() => ""),
                deleteProgram: vi.fn(),
                createVertexArray: vi.fn(() => vao),
                bindVertexArray: vi.fn(),
                deleteVertexArray: vi.fn(),
                createBuffer: vi.fn(() => buffer),
                bindBuffer: vi.fn(),
                bufferData: vi.fn(),
                deleteBuffer: vi.fn(),
                deleteTexture: vi.fn(),
            };
            const canvas = document.createElement("canvas");
            vi.spyOn(canvas, "getContext").mockImplementation(
                () => gl as unknown as WebGL2RenderingContext,
            );
            return { gl, renderer: new ShaderRenderer(canvas) };
        };
        const response = {
            type: "shader" as const,
            vertex_shader: "vertex",
            fragment_shader: "fragment",
            uniforms: {},
            success: true,
        };
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        const noVao = createRenderer(null, { buffer: true });
        expect(noVao.renderer.initFromShaderResponse(response)).toBe(false);
        expect(noVao.gl.createBuffer).not.toHaveBeenCalled();
        expect(noVao.gl.deleteProgram).toHaveBeenCalledTimes(1);

        const noBuffer = createRenderer({ vao: true }, null);
        expect(noBuffer.renderer.initFromShaderResponse(response)).toBe(false);
        expect(noBuffer.gl.deleteProgram).toHaveBeenCalledTimes(1);
        expect(noBuffer.gl.deleteVertexArray).toHaveBeenCalledTimes(1);
        expect(noBuffer.gl.deleteBuffer).not.toHaveBeenCalled();
    });
});
