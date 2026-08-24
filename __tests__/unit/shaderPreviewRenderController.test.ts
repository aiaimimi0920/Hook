// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ShaderRenderer } from "../../src/components/ShaderRenderer";
import { createShaderPreviewRenderController } from "../../src/components/shaderPreviewRenderController";

describe("shader preview render controller", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("presents interactively but skips PNG export outside the image budget", () => {
        vi.useFakeTimers();
        const canvas = document.createElement("canvas");
        canvas.width = 8192;
        canvas.height = 4097;
        const toBlob = vi.fn();
        Object.defineProperty(canvas, "toBlob", { configurable: true, value: toBlob });
        const render = vi.fn();
        const renderer = {
            getCanvas: () => canvas,
            isReady: () => true,
            canPresentOutput: () => true,
            render,
        } as unknown as ShaderRenderer;
        const onRendered = vi.fn();
        const onPresented = vi.fn();
        const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const controller = createShaderPreviewRenderController({
            isCurrentRenderer: (candidate, generation) => candidate === renderer && generation === 1,
            onRendered: () => onRendered,
            onPresented,
        });

        controller.renderRenderer(renderer, 1);
        vi.advanceTimersByTime(120);

        expect(render).toHaveBeenCalledTimes(1);
        expect(onPresented).toHaveBeenCalledTimes(1);
        expect(toBlob).not.toHaveBeenCalled();
        expect(onRendered).not.toHaveBeenCalled();
        expect(warning).toHaveBeenCalledWith(
            "[ShaderPreview] Skipped PNG export outside the shader image budget",
        );
        controller.invalidate();
    });

    it("releases a stuck PNG export so later renders can still publish", () => {
        vi.useFakeTimers();
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const toBlob = vi.fn();
        Object.defineProperty(canvas, "toBlob", { configurable: true, value: toBlob });
        const render = vi.fn();
        const renderer = {
            getCanvas: () => canvas,
            isReady: () => true,
            canPresentOutput: () => true,
            render,
        } as unknown as ShaderRenderer;
        const controller = createShaderPreviewRenderController({
            isCurrentRenderer: (candidate, generation) => candidate === renderer && generation === 1,
            onRendered: () => vi.fn(),
            onPresented: vi.fn(),
        });

        controller.renderRenderer(renderer, 1);
        vi.advanceTimersByTime(120);
        expect(toBlob).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(5000);
        controller.renderRenderer(renderer, 1);
        vi.advanceTimersByTime(120);

        expect(toBlob).toHaveBeenCalledTimes(2);
        expect(render).toHaveBeenCalledTimes(4);
        controller.invalidate();
    });
});
