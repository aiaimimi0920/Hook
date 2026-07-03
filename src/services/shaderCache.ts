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

    /**
     * Prefetch shader code from a Shader Art
     * Returns cached promise if already fetching
     * @param inputPath - Optional path to source image for LUT generation
     * @param referencePath - Optional path to reference image for LUT generation
     */
    async prefetchShader(
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
            return this.getShaderCode(artId);
        }

        // Start fetching
        const promise = this.doFetchShader(artId, artPath, inputPath, referencePath);
        this.prefetchPromises.set(artId, promise);

        try {
            const result = await promise;
            return result;
        } finally {
            this.prefetchPromises.delete(artId);
        }
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

                this.setShaderCode(artId, shaderResponse);
                console.log(`[ShaderCache] Successfully cached shader for Art: ${artId}`);
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
        const existing = this.cache.get(artId);
        if (existing) {
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
            return renderer;
        }

        // Create new renderer
        try {
            renderer = new ShaderRenderer(canvas);
            const success = renderer.initFromShaderResponse(cached.shaderCode);
            if (!success) {
                console.error(`[ShaderCache] Failed to init shader for unit: ${unitId}`);
                return null;
            }
            cached.renderers.set(unitId, renderer);
            console.log(`[ShaderCache] Created renderer for unit: ${unitId}`);
            return renderer;
        } catch (e) {
            console.error(`[ShaderCache] Error creating renderer:`, e);
            return null;
        }
    }

    /**
     * Dispose renderer for a unit (when unit is deleted)
     */
    disposeRenderer(artId: string, unitId: string): void {
        const cached = this.cache.get(artId);
        if (cached) {
            const renderer = cached.renderers.get(unitId);
            if (renderer) {
                renderer.dispose();
                cached.renderers.delete(unitId);
                console.log(`[ShaderCache] Disposed renderer for unit: ${unitId}`);
            }
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
        console.log(`[ShaderCache] Cache cleared`);
    }

    /**
     * Get all cached Art IDs
     */
    getCachedArtIds(): string[] {
        return Array.from(this.cache.keys());
    }
}

// Singleton instance
export const shaderCache = new ShaderCacheService();
