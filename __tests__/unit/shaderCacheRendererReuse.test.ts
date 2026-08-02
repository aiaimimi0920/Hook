// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeShader = {
    type: "shader" as const,
    vertex_shader: "void main() { gl_Position = vec4(0.0); }",
    fragment_shader: "void main() { }",
    uniforms: {},
    textures: {},
    success: true,
};

describe("shaderCache renderer reuse", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(async () => {
        vi.resetModules();
        vi.unmock("../../src/components/ShaderRenderer");
        vi.unmock("../../src/services/api");
        vi.restoreAllMocks();
    });

    it("recreates a cached unit renderer when the requested canvas changes", async () => {
        const rendererInstances: Array<{
            canvas: HTMLCanvasElement;
            dispose: ReturnType<typeof vi.fn>;
        }> = [];

        vi.doMock("../../src/components/ShaderRenderer", () => ({
            ShaderRenderer: class FakeShaderRenderer {
                private readonly canvas: HTMLCanvasElement;
                readonly dispose = vi.fn();

                constructor(canvas: HTMLCanvasElement) {
                    this.canvas = canvas;
                    rendererInstances.push({ canvas, dispose: this.dispose });
                }

                initFromShaderResponse() {
                    return true;
                }

                getCanvas() {
                    return this.canvas;
                }
            },
        }));

        const { shaderCache } = await import("../../src/services/shaderCache");
        shaderCache.clear();
        shaderCache.setShaderCode("art-color-transfer", completeShader);

        const canvasA = document.createElement("canvas");
        const canvasB = document.createElement("canvas");

        const rendererA = shaderCache.getRenderer("art-color-transfer", "unit-1", canvasA);
        const rendererB = shaderCache.getRenderer("art-color-transfer", "unit-1", canvasB);

        expect(rendererA).toBeTruthy();
        expect(rendererB).toBeTruthy();
        expect(rendererB).not.toBe(rendererA);
        expect(rendererInstances).toHaveLength(2);
        expect(rendererInstances[0]?.dispose).toHaveBeenCalledTimes(1);
        expect(rendererInstances[1]?.canvas).toBe(canvasB);

        shaderCache.clear();
    });

    it("disposes cached renderers and rebuilds them when shader code changes", async () => {
        const rendererInstances: Array<{
            dispose: ReturnType<typeof vi.fn>;
            initFromShaderResponse: ReturnType<typeof vi.fn>;
        }> = [];

        vi.doMock("../../src/components/ShaderRenderer", () => ({
            ShaderRenderer: class FakeShaderRenderer {
                private readonly canvas: HTMLCanvasElement;
                readonly dispose = vi.fn();
                readonly initFromShaderResponse = vi.fn((_response: unknown) => true);

                constructor(canvas: HTMLCanvasElement) {
                    this.canvas = canvas;
                    rendererInstances.push({
                        dispose: this.dispose,
                        initFromShaderResponse: this.initFromShaderResponse,
                    });
                }

                getCanvas() {
                    return this.canvas;
                }
            },
        }));

        const { shaderCache } = await import("../../src/services/shaderCache");
        shaderCache.clear();
        const canvas = document.createElement("canvas");
        const updatedShader = {
            ...completeShader,
            fragment_shader: "void main() { gl_FragDepth = 1.0; }",
            uniforms: { strength: 0.75 },
        };

        shaderCache.setShaderCode("art-color-transfer", completeShader);
        const rendererA = shaderCache.getRenderer("art-color-transfer", "unit-1", canvas);
        shaderCache.setShaderCode("art-color-transfer", { ...completeShader });

        expect(rendererInstances).toHaveLength(1);
        expect(rendererInstances[0]?.dispose).not.toHaveBeenCalled();

        shaderCache.setShaderCode("art-color-transfer", updatedShader);
        expect(rendererInstances[0]?.dispose).toHaveBeenCalledTimes(1);

        const rendererB = shaderCache.getRenderer("art-color-transfer", "unit-1", canvas);
        expect(rendererB).not.toBe(rendererA);
        expect(rendererInstances).toHaveLength(2);
        expect(rendererInstances[1]?.initFromShaderResponse).toHaveBeenCalledWith(updatedShader);

        shaderCache.disposeRenderer("art-color-transfer", "unit-1", rendererA ?? undefined);
        expect(rendererInstances[1]?.dispose).not.toHaveBeenCalled();
        expect(shaderCache.getRenderer("art-color-transfer", "unit-1", canvas)).toBe(rendererB);

        shaderCache.clear();
    });

    it("ignores a stale forced prefetch without clearing or overwriting the current request", async () => {
        const fetchResolves: Array<(value: unknown) => void> = [];
        const prefetchShader = vi.fn(() => new Promise((resolve) => fetchResolves.push(resolve)));
        vi.doMock("../../src/services/api", () => ({
            isTauriRuntimeAvailable: () => true,
            api: { prefetchShader },
        }));

        const { shaderCache } = await import("../../src/services/shaderCache");
        shaderCache.clear();
        const response = (fragmentShader: string) => ({
            type: "shader",
            vertex_shader: "vertex",
            fragment_shader: fragmentShader,
            uniforms: {},
            textures: {},
        });

        const staleRequest = shaderCache.prefetchShader("art-color-transfer", undefined, true);
        const currentRequest = shaderCache.prefetchShader("art-color-transfer", undefined, true);
        expect(prefetchShader).toHaveBeenCalledTimes(2);

        fetchResolves[0]?.(response("stale-fragment"));
        await expect(staleRequest).resolves.toBeNull();

        const sharedCurrentRequest = shaderCache.prefetchShader("art-color-transfer");
        expect(prefetchShader).toHaveBeenCalledTimes(2);

        fetchResolves[1]?.(response("current-fragment"));
        await expect(currentRequest).resolves.toMatchObject({ fragment_shader: "current-fragment" });
        await expect(sharedCurrentRequest).resolves.toMatchObject({ fragment_shader: "current-fragment" });
        expect(shaderCache.getShaderCode("art-color-transfer")?.fragment_shader).toBe("current-fragment");

        shaderCache.clear();
    });
});
