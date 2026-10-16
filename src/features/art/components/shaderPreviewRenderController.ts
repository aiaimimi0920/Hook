import { untrack } from "solid-js";

import type { ShaderRenderer } from "./ShaderRenderer";
import { isShaderImageSizeWithinBudget } from "../services/shaderImagePolicy";

interface RenderExportRequest {
    renderer: ShaderRenderer;
    generation: number;
    seq: number;
}

interface CreateShaderPreviewRenderControllerOptions {
    isCurrentRenderer: (renderer: ShaderRenderer, generation: number) => boolean;
    onRendered: () => ((dataUrl: string) => void) | undefined;
    onPresented: () => void;
}

const RENDER_EXPORT_TIMEOUT_MS = 5000;

/** Owns animation-frame coalescing and latest-only asynchronous PNG publication. */
export const createShaderPreviewRenderController = (
    options: CreateShaderPreviewRenderControllerOptions,
) => {
    let renderExportSeq = 0;
    let lastRenderedDataUrl = "";
    let renderExportTimer: number | null = null;
    let renderFrameId: number | null = null;
    let pendingFrameRender: { renderer: ShaderRenderer; generation: number } | null = null;
    let pendingRenderExport: RenderExportRequest | null = null;
    let renderExportInFlight = false;
    let activeExportCompletion: (() => void) | null = null;

    const clearRenderExportTimer = () => {
        if (renderExportTimer !== null && typeof window !== "undefined") {
            window.clearTimeout(renderExportTimer);
        }
        renderExportTimer = null;
    };

    const clearScheduledRender = () => {
        if (renderFrameId !== null && typeof window !== "undefined") {
            window.cancelAnimationFrame(renderFrameId);
        }
        renderFrameId = null;
        pendingFrameRender = null;
    };

    const invalidate = () => {
        renderExportSeq++;
        clearRenderExportTimer();
        pendingRenderExport = null;
        clearScheduledRender();
        activeExportCompletion?.();
    };

    const finishRenderedExport = () => {
        renderExportInFlight = false;
        const pending = pendingRenderExport;
        pendingRenderExport = null;
        if (pending) {
            untrack(() => startRenderedExport(pending));
        }
    };

    const startRenderedExport = (request: RenderExportRequest) => {
        const { renderer, generation, seq } = request;
        if (
            !options.onRendered()
            || seq !== renderExportSeq
            || !options.isCurrentRenderer(renderer, generation)
        ) {
            return;
        }
        if (renderExportInFlight) {
            pendingRenderExport = request;
            return;
        }

        renderExportInFlight = true;
        let completed = false;
        let watchdogTimer: number | null = null;
        const complete = () => {
            if (completed) return;
            completed = true;
            if (watchdogTimer !== null && typeof window !== "undefined") {
                window.clearTimeout(watchdogTimer);
            }
            if (activeExportCompletion === complete) activeExportCompletion = null;
            finishRenderedExport();
        };
        activeExportCompletion = complete;
        if (typeof window !== "undefined") {
            watchdogTimer = window.setTimeout(complete, RENDER_EXPORT_TIMEOUT_MS);
        }

        const canvas = renderer.getCanvas();
        if (!isShaderImageSizeWithinBudget(canvas.width, canvas.height)) {
            console.warn("[ShaderPreview] Skipped PNG export outside the shader image budget");
            complete();
            return;
        }
        // The interactive buffer is not preserved; repaint only when an export is requested.
        try {
            renderer.render();
            canvas.toBlob((blob) => {
                if (
                    !blob
                    || seq !== renderExportSeq
                    || !options.isCurrentRenderer(renderer, generation)
                ) {
                    complete();
                    return;
                }

                const reader = new FileReader();
                reader.onloadend = () => {
                    try {
                        if (
                            seq !== renderExportSeq
                            || !options.isCurrentRenderer(renderer, generation)
                            || typeof reader.result !== "string"
                        ) {
                            return;
                        }

                        const dataUrl = reader.result;
                        if (dataUrl !== lastRenderedDataUrl) {
                            lastRenderedDataUrl = dataUrl;
                            options.onRendered()?.(dataUrl);
                        }
                    } finally {
                        complete();
                    }
                };
                reader.onerror = complete;
                reader.onabort = complete;
                try {
                    reader.readAsDataURL(blob);
                } catch {
                    complete();
                }
            }, "image/png");
        } catch {
            complete();
        }
    };

    const scheduleRenderedExport = (renderer: ShaderRenderer, generation: number) => {
        if (!options.onRendered() || typeof window === "undefined") return;
        clearRenderExportTimer();
        const seq = ++renderExportSeq;
        renderExportTimer = window.setTimeout(() => {
            renderExportTimer = null;
            untrack(() => startRenderedExport({ renderer, generation, seq }));
        }, 120);
    };

    const renderRenderer = (renderer: ShaderRenderer, generation: number) => {
        if (!options.isCurrentRenderer(renderer, generation) || !renderer.isReady()) return;
        const presentableRenderer = renderer as ShaderRenderer & { canPresentOutput?: () => boolean };
        const canPresentOutput = typeof presentableRenderer.canPresentOutput === "function"
            ? presentableRenderer.canPresentOutput()
            : renderer.isReady();
        if (!canPresentOutput) return;

        renderer.render();
        options.onPresented();
        scheduleRenderedExport(renderer, generation);
    };

    const scheduleRendererRender = (renderer: ShaderRenderer, generation: number) => {
        if (!options.isCurrentRenderer(renderer, generation)) return;
        pendingFrameRender = { renderer, generation };
        if (renderFrameId !== null) return;
        if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
            const pending = pendingFrameRender;
            pendingFrameRender = null;
            if (pending) renderRenderer(pending.renderer, pending.generation);
            return;
        }

        renderFrameId = window.requestAnimationFrame(() => {
            renderFrameId = null;
            const pending = pendingFrameRender;
            pendingFrameRender = null;
            if (pending) renderRenderer(pending.renderer, pending.generation);
        });
    };

    return {
        invalidate,
        resetPublishedDataUrl: () => {
            lastRenderedDataUrl = "";
        },
        renderRenderer,
        scheduleRendererRender,
    };
};
