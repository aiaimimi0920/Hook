/**
 * ShaderRenderer - Generic WebGL2 Dynamic Shader Executor
 *
 * This is a generic shader renderer that can dynamically compile and execute
 * any shader code provided by Python Arts. It handles:
 * - Dynamic shader compilation from strings
 * - Multiple 2D texture inputs (mapped by name, e.g., 'input' -> 'u_input')
 * - Uniform setting for real-time parameter adjustment
 */

import { logger } from "../services/logger";
import {
    MAX_SHADER_TEXTURE_DIMENSION,
    isShaderImageSizeWithinBudget,
} from "../services/shaderImagePolicy";

/**
 * Generic shader uniforms interface
 */
export interface ShaderUniforms {
    [key: string]: number;
}

/**
 * Shader response from Python Art.
 */
export interface ShaderSuccessResponse {
    type: 'shader';
    vertex_shader: string;
    fragment_shader: string;
    uniforms: ShaderUniforms;
    textures?: Record<string, string>; // name -> src (Data URI)
    success: boolean;
}

export interface UnsupportedShaderResponse {
    type: 'unsupported';
    success: false;
}

export type ShaderResponse = ShaderSuccessResponse | UnsupportedShaderResponse;

/**
 * WebGL2 Dynamic Shader Renderer
 *
 * Accepts shader code from Python and compiles it dynamically.
 * Supports multiple texture inputs mapped by name.
 */
export class ShaderRenderer {
    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram | null = null;
    private vao: WebGLVertexArrayObject | null = null;
    private vertexBuffer: WebGLBuffer | null = null;
    private textures: Map<string, WebGLTexture> = new Map();
    private requiredTextureNames: Set<string> = new Set();
    private textureUnits: Map<string, number> = new Map();
    private textureLoadGenerations: Map<string, number> = new Map();
    private uniformLocations: Map<string, WebGLUniformLocation | null> = new Map();
    private nextTextureLoadGeneration: number = 0;
    private currentUniforms: ShaderUniforms = {};
    private canvasWidth: number = 0;
    private canvasHeight: number = 0;
    private textureLoadHandler?: () => void;
    private lifecycleGeneration: number = 0;
    private disposed: boolean = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const gl = canvas.getContext('webgl2', {
            alpha: true,
            antialias: false,
            preserveDrawingBuffer: false
        });

        if (!gl) {
            throw new Error('WebGL2 not supported');
        }
        this.gl = gl;
    }

    /**
     * Initialize shaders from Python-provided code
     */
    initFromShaderResponse(response: ShaderSuccessResponse): boolean {
        if (this.disposed) return false;

        const gl = this.gl;
        this.lifecycleGeneration += 1;
        this.releaseResources();

        // Compile shaders from Python code
        this.program = this.createProgram(
            response.vertex_shader,
            response.fragment_shader
        );

        if (!this.program) {
            console.error('Failed to compile shader from Python');
            return false;
        }

        // Create fullscreen quad VAO
        const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
        this.vao = gl.createVertexArray();
        if (!this.vao) {
            console.error("Failed to allocate shader vertex array");
            this.releaseResources();
            return false;
        }
        gl.bindVertexArray(this.vao);

        this.vertexBuffer = gl.createBuffer();
        if (!this.vertexBuffer) {
            console.error("Failed to allocate shader vertex buffer");
            this.releaseResources();
            return false;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        if (posLoc < 0) {
            console.error("Shader is missing the required a_position attribute");
            this.releaseResources();
            return false;
        }
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        // Store initial uniforms
        this.currentUniforms = { ...response.uniforms };

        // Load textures from response (Async)
        if (response.textures) {
            Object.entries(response.textures).forEach(([name, src]) => {
                if (!src) return;
                this.requiredTextureNames.add(name);
                this.loadTextureFromSrc(name, src);
            });
        }

        return true;
    }

    setTextureLoadHandler(handler?: () => void): void {
        if (this.disposed) return;
        this.textureLoadHandler = handler;
    }

    private createProgram(vsSource: string, fsSource: string): WebGLProgram | null {
        const gl = this.gl;

        const compileShader = (type: number, source: string): WebGLShader | null => {
            const shader = gl.createShader(type);
            if (!shader) return null;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error('Shader compile error:', gl.getShaderInfoLog(shader));
                console.error('Shader source:', source);
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        };

        const vs = compileShader(gl.VERTEX_SHADER, vsSource);
        const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) {
            if (vs) gl.deleteShader(vs);
            if (fs) gl.deleteShader(fs);
            return null;
        }

        const program = gl.createProgram();
        if (!program) {
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            return null;
        }
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            return null;
        }

        // Clean up shaders after linking
        gl.deleteShader(vs);
        gl.deleteShader(fs);

        return program;
    }

    /**
     * Load a texture input by name (e.g., 'input', 'reference')
     * The texture will be bound to uniform 'u_<name>'
     */
    loadTexture(name: string, image: HTMLImageElement | HTMLCanvasElement | ImageBitmap): boolean {
        if (this.disposed) return false;

        const gl = this.gl;
        const reportedLimit = typeof gl.getParameter === "function"
            ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))
            : MAX_SHADER_TEXTURE_DIMENSION;
        const maxDimension = Number.isFinite(reportedLimit) && reportedLimit > 0
            ? Math.min(MAX_SHADER_TEXTURE_DIMENSION, reportedLimit)
            : MAX_SHADER_TEXTURE_DIMENSION;
        if (!isShaderImageSizeWithinBudget(image.width, image.height, maxDimension)) {
            console.warn(`[ShaderRenderer] Rejected oversized texture '${name}' (${image.width}x${image.height})`);
            this.discardTexture(name);
            return false;
        }

        let textureUnit = this.textureUnits.get(name);
        if (textureUnit === undefined) {
            const reportedUnitLimit = typeof gl.getParameter === "function"
                && typeof gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS === "number"
                ? Number(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS))
                : 16;
            const maxTextureUnits = Number.isFinite(reportedUnitLimit) && reportedUnitLimit > 0
                ? Math.floor(reportedUnitLimit)
                : 16;
            const usedUnits = new Set(this.textureUnits.values());
            textureUnit = 0;
            while (usedUnits.has(textureUnit)) textureUnit += 1;
            if (textureUnit >= maxTextureUnits) {
                console.warn(`[ShaderRenderer] Rejected texture '${name}': texture unit limit reached`);
                this.discardTexture(name);
                return false;
            }
        }

        // Get or create texture only after a sampler unit is available.
        let texture = this.textures.get(name);
        if (!texture) {
            const createdTexture = gl.createTexture();
            if (!createdTexture) {
                console.error(`[ShaderRenderer] Failed to allocate texture '${name}'`);
                return false;
            }
            texture = createdTexture;
            this.textures.set(name, texture);
        }
        this.textureUnits.set(name, textureUnit);

        try {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        } catch (error) {
            console.error(`[ShaderRenderer] Failed to upload texture '${name}'`, error);
            this.discardTexture(name);
            return false;
        }
        const noError = typeof gl.NO_ERROR === "number" ? gl.NO_ERROR : 0;
        const uploadError = typeof gl.getError === "function" ? gl.getError() : noError;
        if (uploadError !== noError) {
            console.error(`[ShaderRenderer] WebGL rejected texture '${name}' with error ${uploadError}`);
            this.discardTexture(name);
            return false;
        }

        // Update canvas size to match primary input
        if (name === 'input' && (this.canvasWidth !== image.width || this.canvasHeight !== image.height)) {
            this.canvas.width = image.width;
            this.canvas.height = image.height;
            this.canvasWidth = image.width;
            this.canvasHeight = image.height;
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        }
        return true;
    }

    /**
     * Load a texture from a source string (URL or Data URI)
     */
    loadTextureFromSrc(name: string, src: string): void {
        if (this.disposed) return;

        const lifecycleGeneration = this.lifecycleGeneration;
        const textureLoadGeneration = ++this.nextTextureLoadGeneration;
        this.textureLoadGenerations.set(name, textureLoadGeneration);
        const img = new Image();
        img.onload = () => {
            if (
                this.disposed
                || lifecycleGeneration !== this.lifecycleGeneration
                || this.textureLoadGenerations.get(name) !== textureLoadGeneration
            ) {
                return;
            }
            if (!this.loadTexture(name, img)) return;
            logger.debug(`[ShaderRenderer] Loaded texture '${name}' from response`);
            if (this.textureLoadHandler) {
                this.textureLoadHandler();
            } else {
                this.render(); // Trigger re-render once loaded
            }
        };
        img.onerror = (e) => {
            if (
                this.disposed
                || lifecycleGeneration !== this.lifecycleGeneration
                || this.textureLoadGenerations.get(name) !== textureLoadGeneration
            ) {
                return;
            }
            console.error(`[ShaderRenderer] Failed to load texture '${name}'`, e);
        };
        img.src = src;
    }

    removeTexture(name: string): void {
        if (this.disposed || name === 'input' || this.requiredTextureNames.has(name)) return;

        this.discardTexture(name);
        this.requiredTextureNames.delete(name);
    }

    private discardTexture(name: string): void {
        const texture = this.textures.get(name);
        if (texture) {
            this.gl.deleteTexture(texture);
            this.textures.delete(name);
        }
        this.textureUnits.delete(name);
        this.textureLoadGenerations.delete(name);
        this.uniformLocations.delete(`u_${name}`);
    }


    /**
     * Update a single uniform value (for real-time slider adjustment)
     */
    setUniform(name: string, value: number): void {
        if (this.disposed) return;
        this.currentUniforms[name] = value;
    }

    private getUniformLocation(name: string): WebGLUniformLocation | null {
        if (!this.program) return null;
        if (this.uniformLocations.has(name)) {
            return this.uniformLocations.get(name) ?? null;
        }
        const location = this.gl.getUniformLocation(this.program, name);
        this.uniformLocations.set(name, location);
        return location;
    }

    /**
     * Render with current or provided uniforms
     */
    render(uniforms?: Partial<ShaderUniforms>): void {
        if (this.disposed || !this.program || this.textures.size === 0) return;

        const gl = this.gl;
        const u = uniforms ? { ...this.currentUniforms, ...uniforms } : this.currentUniforms;

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        // Bind all textures
        for (const [name, texture] of this.textures) {
            const unit = this.textureUnits.get(name) ?? 0;
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, texture);

            // Set sampler uniform (u_input, u_reference, etc.)
            const uniformName = `u_${name}`;
            const loc = this.getUniformLocation(uniformName);
            if (loc !== null) {
                gl.uniform1i(loc, unit);
            }
        }

        // Set all uniforms dynamically
        for (const [name, value] of Object.entries(u)) {
            const loc = this.getUniformLocation(`u_${name}`);
            if (loc !== null) {
                if (typeof value === 'number') {
                    gl.uniform1f(loc, value);
                } else if (typeof value === 'boolean') {
                    gl.uniform1f(loc, value ? 1.0 : 0.0);
                }
            }
        }

        // Draw fullscreen quad
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * Get the rendering canvas
     */
    getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    /**
     * Check if the renderer is ready
     */
    isReady(): boolean {
        return !this.disposed && this.program !== null && this.textures.has('input');
    }

    /**
     * Check whether every texture required by the shader response has
     * finished loading, so the preview can safely replace any persisted
     * fallback image without flashing a blank frame.
     */
    canPresentOutput(): boolean {
        if (!this.isReady()) return false;
        for (const textureName of this.requiredTextureNames) {
            if (!this.textures.has(textureName)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Dispose of all WebGL resources
     */
    dispose(): void {
        if (this.disposed) return;

        this.disposed = true;
        this.lifecycleGeneration += 1;
        this.textureLoadHandler = undefined;
        this.releaseResources();
    }

    private releaseResources(): void {
        const gl = this.gl;

        for (const texture of this.textures.values()) {
            gl.deleteTexture(texture);
        }
        this.textures.clear();
        this.requiredTextureNames.clear();
        this.textureUnits.clear();
        this.textureLoadGenerations.clear();
        this.uniformLocations.clear();

        if (this.program) gl.deleteProgram(this.program);
        if (this.vao) gl.deleteVertexArray(this.vao);
        if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
        this.program = null;
        this.vao = null;
        this.vertexBuffer = null;
        this.nextTextureLoadGeneration = 0;
        this.currentUniforms = {};
        this.canvasWidth = 0;
        this.canvasHeight = 0;
    }
}
