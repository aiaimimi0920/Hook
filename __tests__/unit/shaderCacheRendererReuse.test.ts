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
});
