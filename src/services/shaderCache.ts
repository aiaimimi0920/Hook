/**
 * ShaderCache - Manages shader programs for Shader Arts
 *
 * This service handles:
 * - Prefetching shader code from Python Arts during Art library refresh
 * - Caching compiled ShaderRenderer instances per Art ID
 * - Providing quick access to shader renderers for real-time preview
 */

import { api, isTauriRuntimeAvailable } from './api';

import { ShaderRenderer, type ShaderSuccessResponse } from '../components/ShaderRenderer';

/**
 * Cached shader entry
 */
interface CachedShader {
    artId: string;
    shaderCode: ShaderSuccessResponse;
    renderers: Map<string, ShaderRenderer>;  // Key: unitId, Value: ShaderRenderer instance
}

/**
 * ShaderCache singleton
 */
class ShaderCacheService {
    private cache: Map<string, CachedShader> = new Map();
    private prefetchPromises: Map<string, Promise<ShaderSuccessResponse | null>> = new Map();
    private prefetchGenerations: Map<string, number> = new Map();
    private nextPrefetchGeneration: number = 0;

    /**
     * Prefetch shader code from a Shader Art
     * Returns cached promise if already fetching
     * @param inputPath - Optional path to source image for LUT generation
     * @param referencePath - Optional path to reference image for LUT generation
     */
    prefetchShader(
        artId: string,
        artPath?: string,
        force: boolean = false,
        inputPath?: string,
        referencePath?: string
    ): Promise<ShaderSuccessResponse | null> {
        // Return existing promise if already fetching
        const existingPromise = this.prefetchPromises.get(artId);
        if (existingPromise && !force) {
            return existingPromise;
        }

        // Return cached shader if already available (unless forced)
        if (!force && this.hasShaderCode(artId)) {
            return Promise.resolve(this.getShaderCode(artId));
        }

        // Start fetching
        const generation = ++this.nextPrefetchGeneration;
        this.prefetchGenerations.set(artId, generation);
        let promise: Promise<ShaderSuccessResponse | null>;
        promise = this.doFetchShader(artId, artPath, inputPath, referencePath)
            .then((result) => {
                if (this.prefetchGenerations.get(artId) !== generation) {
                    return null;
                }
                if (result) {
                    this.storeShaderCode(artId, result);
                    console.log(`[ShaderCache] Successfully cached shader for Art: ${artId}`);
                }
                return result;
            })
            .finally(() => {
                if (this.prefetchPromises.get(artId) === promise) {
                    this.prefetchPromises.delete(artId);
                }
            });
        this.prefetchPromises.set(artId, promise);
        return promise;
    }

    private async doFetchShader(artId: string, artPath?: string, inputPath?: string, referencePath?: string): Promise<ShaderSuccessResponse | null> {
        if (!isTauriRuntimeAvailable()) {
            return null;
        }
        try {
            console.log(`[ShaderCache] Prefetching shader for Art: ${artId}`);
            if (inputPath || referencePath) {
                console.log(`[ShaderCache] With paths - input: ${inputPath || '<none>'}, reference: ${referencePath || '<none>'}`);
            }

            const response = await api.prefetchShader({
                artId,
                artPath: artPath ?? null,
                inputPath: inputPath ?? null,
                referencePath: referencePath ?? null
            });


            // Validate response
            if (response && response.type === 'shader' && response.vertex_shader && response.fragment_shader) {
                const shaderResponse: ShaderSuccessResponse = {
                    type: 'shader',
                    vertex_shader: response.vertex_shader,
                    fragment_shader: response.fragment_shader,
                    uniforms: response.uniforms || {},
                    textures: response.textures || {},  // CRITICAL: Include textures (contains LUT!)
                    success: true
                };

                return shaderResponse;
            } else {
                console.warn(`[ShaderCache] Invalid shader response for Art: ${artId}`, response);
                return null;
            }
        } catch (e) {
            console.error(`[ShaderCache] Failed to prefetch shader for Art: ${artId}`, e);
            return null;
        }
    }

    /**
     * Store shader code for an Art
     */
    setShaderCode(artId: string, shaderCode: ShaderSuccessResponse): void {
        this.prefetchGenerations.set(artId, ++this.nextPrefetchGeneration);
        this.prefetchPromises.delete(artId);
        this.storeShaderCode(artId, shaderCode);
    }

    private storeShaderCode(artId: string, shaderCode: ShaderSuccessResponse): void {
        const existing = this.cache.get(artId);
        if (existing) {
            if (!shaderResponsesEqual(existing.shaderCode, shaderCode)) {
                for (const renderer of existing.renderers.values()) {
                    renderer.dispose();
                }
                existing.renderers.clear();
            }
            existing.shaderCode = shaderCode;
        } else {
            this.cache.set(artId, {
                artId,
                shaderCode,
                renderers: new Map()
            });
        }
        console.log(`[ShaderCache] Cached shader for Art: ${artId}`);
    }

    /**
     * Get cached shader code for an Art
     */
    getShaderCode(artId: string): ShaderSuccessResponse | null {
        return this.cache.get(artId)?.shaderCode ?? null;
    }

    /**
     * Check if shader code is cached for an Art
     */
    hasShaderCode(artId: string): boolean {
        return this.cache.has(artId);
    }

    /**
     * Get or create a ShaderRenderer for a specific unit
     */
    getRenderer(artId: string, unitId: string, canvas: HTMLCanvasElement): ShaderRenderer | null {
        const cached = this.cache.get(artId);
        if (!cached) {
            console.warn(`[ShaderCache] No shader cached for Art: ${artId}`);
            return null;
        }

        // Check if we already have a renderer for this unit
        let renderer = cached.renderers.get(unitId);
        if (renderer) {
            const boundCanvas =
                typeof (renderer as ShaderRenderer & { getCanvas?: () => HTMLCanvasElement }).getCanvas === "function"
                    ? (renderer as ShaderRenderer & { getCanvas: () => HTMLCanvasElement }).getCanvas()
                    : null;
            if (boundCanvas && boundCanvas !== canvas) {
                renderer.dispose();
                cached.renderers.delete(unitId);
                console.log(`[ShaderCache] Recreating renderer for unit ${unitId} because the canvas changed`);
                renderer = undefined;
            } else {
                return renderer;
            }
        }

        // Create new renderer
        try {
            renderer = new ShaderRenderer(canvas);
            const success = renderer.initFromShaderResponse(cached.shaderCode);
            if (!success) {
                renderer.dispose();
                console.error(`[ShaderCache] Failed to init shader for unit: ${unitId}`);
                return null;
            }
            cached.renderers.set(unitId, renderer);
            console.log(`[ShaderCache] Created renderer for unit: ${unitId}`);
            return renderer;
        } catch (e) {
            renderer?.dispose();
            console.error(`[ShaderCache] Error creating renderer:`, e);
            return null;
        }
    }

    /**
     * Dispose renderer for a unit (when unit is deleted)
     */
    disposeRenderer(artId: string, unitId: string, expectedRenderer?: ShaderRenderer): void {
        const cached = this.cache.get(artId);
        if (!cached) {
            expectedRenderer?.dispose();
            return;
        }
        const renderer = cached.renderers.get(unitId);
        if (expectedRenderer && renderer !== expectedRenderer) {
            expectedRenderer.dispose();
            return;
        }
        if (renderer) {
            renderer.dispose();
            cached.renderers.delete(unitId);
            console.log(`[ShaderCache] Disposed renderer for unit: ${unitId}`);
        }
    }

    /**
     * Clear all cached shaders and renderers
     */
    clear(): void {
        for (const cached of this.cache.values()) {
            for (const renderer of cached.renderers.values()) {
                renderer.dispose();
            }
        }
        this.cache.clear();
        this.prefetchPromises.clear();
        this.prefetchGenerations.clear();
        console.log(`[ShaderCache] Cache cleared`);
    }

    /**
     * Get all cached Art IDs
     */
    getCachedArtIds(): string[] {
        return Array.from(this.cache.keys());
    }
}

const recordsEqual = <T extends number | string>(
    left: Record<string, T> | undefined,
    right: Record<string, T> | undefined,
): boolean => {
    const leftEntries = Object.entries(left ?? {}).sort(([leftKey], [rightKey]) =>
        leftKey.localeCompare(rightKey),
    );
    const rightEntries = Object.entries(right ?? {}).sort(([leftKey], [rightKey]) =>
        leftKey.localeCompare(rightKey),
    );
    if (leftEntries.length !== rightEntries.length) return false;
    return leftEntries.every(([key, value], index) =>
        rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value,
    );
};

const shaderResponsesEqual = (
    left: ShaderSuccessResponse,
    right: ShaderSuccessResponse,
): boolean => left.vertex_shader === right.vertex_shader
    && left.fragment_shader === right.fragment_shader
    && recordsEqual(left.uniforms, right.uniforms)
    && recordsEqual(left.textures, right.textures);

// Singleton instance
export const shaderCache = new ShaderCacheService();
