/**
 * ShaderRenderer - Generic WebGL2 Dynamic Shader Executor
 *
 * This is a generic shader renderer that can dynamically compile and execute
 * any shader code provided by Python Arts. It handles:
 * - Dynamic shader compilation from strings
 * - Multiple 2D texture inputs (mapped by name, e.g., 'input' -> 'u_input')
 * - Uniform setting for real-time parameter adjustment
 */

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
    private textures: Map<string, WebGLTexture> = new Map();
    private textureUnits: Map<string, number> = new Map();
    private nextTextureUnit: number = 0;
    private currentUniforms: ShaderUniforms = {};
    private canvasWidth: number = 0;
    private canvasHeight: number = 0;
    private textureLoadHandler?: () => void;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const gl = canvas.getContext('webgl2', {
            alpha: true,
            antialias: false,
            preserveDrawingBuffer: true
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
        const gl = this.gl;

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
        gl.bindVertexArray(this.vao);

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        // Store initial uniforms
        this.currentUniforms = { ...response.uniforms };

        // Load textures from response (Async)
        if (response.textures) {
            Object.entries(response.textures).forEach(([name, src]) => {
                this.loadTextureFromSrc(name, src);
            });
        }

        return true;
    }

    setTextureLoadHandler(handler?: () => void): void {
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
                return null;
            }
            return shader;
        };

        const vs = compileShader(gl.VERTEX_SHADER, vsSource);
        const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return null;

        const program = gl.createProgram();
        if (!program) return null;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
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
    loadTexture(name: string, image: HTMLImageElement | HTMLCanvasElement | ImageBitmap): void {
        const gl = this.gl;

        // Get or create texture
        let texture = this.textures.get(name);
        if (!texture) {
            texture = gl.createTexture()!;
            this.textures.set(name, texture);

            // Assign texture unit
            this.textureUnits.set(name, this.nextTextureUnit);
            this.nextTextureUnit++;
        }

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // Update canvas size to match primary input
        if (name === 'input' && (this.canvasWidth !== image.width || this.canvasHeight !== image.height)) {
            this.canvas.width = image.width;
            this.canvas.height = image.height;
            this.canvasWidth = image.width;
            this.canvasHeight = image.height;
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        }
    }

    /**
     * Load a texture from a source string (URL or Data URI)
     */
    loadTextureFromSrc(name: string, src: string): void {
        const img = new Image();
        img.onload = () => {
            this.loadTexture(name, img);
            console.log(`[ShaderRenderer] Loaded texture '${name}' from response`);
            if (this.textureLoadHandler) {
                this.textureLoadHandler();
            } else {
                this.render(); // Trigger re-render once loaded
            }
        };
        img.onerror = (e) => {
            console.error(`[ShaderRenderer] Failed to load texture '${name}'`, e);
        };
        img.src = src;
    }


    /**
     * Update a single uniform value (for real-time slider adjustment)
     */
    setUniform(name: string, value: number): void {
        this.currentUniforms[name] = value;
    }

    /**
     * Render with current or provided uniforms
     */
    render(uniforms?: Partial<ShaderUniforms>): void {
        if (!this.program || this.textures.size === 0) return;

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
            const loc = gl.getUniformLocation(this.program, uniformName);
            if (loc) {
                gl.uniform1i(loc, unit);
            }
        }

        // Set all uniforms dynamically
        for (const [name, value] of Object.entries(u)) {
            const loc = gl.getUniformLocation(this.program, `u_${name}`);
            if (loc) {
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
     * Get the rendered image as a data URL
     */
    toDataURL(type: string = 'image/png', quality?: number): string {
        return this.canvas.toDataURL(type, quality);
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
        return this.program !== null && this.textures.has('input');
    }

    /**
     * Dispose of all WebGL resources
     */
    dispose(): void {
        const gl = this.gl;

        for (const texture of this.textures.values()) {
            gl.deleteTexture(texture);
        }
        this.textures.clear();
        this.textureUnits.clear();

        if (this.program) gl.deleteProgram(this.program);
        if (this.vao) gl.deleteVertexArray(this.vao);

        this.program = null;
        this.vao = null;
        this.nextTextureUnit = 0;
    }
}
