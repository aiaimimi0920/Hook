/**
 * ShaderPreview - WebGL canvas component for Shader Art real-time preview.
 */

import { Component, createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { api, isTauriRuntimeAvailable } from "../services/api";
import { isLikelyLocalFilePath } from "../services/imageSource";
import { shaderCache } from "../services/shaderCache";
import {
    isShaderImageSizeWithinBudget,
    resolveShaderBrowserImageUrl,
} from "../services/shaderImagePolicy";
import { ShaderRenderer, type ShaderSuccessResponse } from "./ShaderRenderer";
import { computeContainFitPlacement } from "../services/stickerEditing";
import { createShaderPreviewRenderController } from "./shaderPreviewRenderController";

interface Props {
    unitId: string;
    artId: string;
    params: Record<string, unknown>;
    holdFallbackPreview?: boolean;
    fallbackPreviewSrc?: string;
    inputImageSrc?: string;
    referenceImageSrc?: string;
    requiresReference?: boolean;
    width: number;
    height: number;
    opacity?: number;
    onRendered?: (dataUrl: string) => void;
    onIntrinsicSizeChange?: (size: { w: number; h: number }) => void;
    resolveUnitImage?: (unitId: string) => string | undefined;
}

export const ShaderPreview: Component<Props> = (props) => {
    let canvasRef: HTMLCanvasElement | undefined;
    let renderer: ShaderRenderer | null = null;
    let rendererArtId = "";
    let rendererUnitId = "";
    let rendererGeneration = 0;
    let disposed = false;
    let rendererRequestSeq = 0;
    let inputImageRequestSeq = 0;
    let lastShaderContextKey = "";
    let lastInputSrc = "";
    let lastReactiveResetKey = "";
    let lastFallbackRecoveryAttemptSrc = "";
    let fallbackRecoveryRequestSeq = 0;
    let contextualPrefetchRetryTimer: number | null = null;
    let contextualPrefetchRetryAttempts = 0;
    let paramsNeedFullReapply = true;
    const parameterTextureRequestSeq = new Map<string, number>();
    const prevParamsRef: { current: Record<string, unknown> } = { current: {} };
    const [inputImageSize, setInputImageSize] = createSignal<{ width: number; height: number } | null>(null);
    const [fallbackPreviewSize, setFallbackPreviewSize] = createSignal<{ width: number; height: number } | null>(null);
    const [fallbackPreviewSrcOverride, setFallbackPreviewSrcOverride] = createSignal<string | undefined>(undefined);
    const [hasRenderedThisMount, setHasRenderedThisMount] = createSignal(false);

    const clearContextualPrefetchRetry = () => {
        if (contextualPrefetchRetryTimer !== null && typeof window !== "undefined") {
            window.clearTimeout(contextualPrefetchRetryTimer);
        }
        contextualPrefetchRetryTimer = null;
    };

    const shaderHasIncompleteSupportTextures = (shader: ShaderSuccessResponse | null | undefined) => {
        if (!shader?.textures) return false;
        return Object.values(shader.textures).some((src) => typeof src !== "string" || src.length === 0);
    };

    const scheduleContextualPrefetchRetry = () => {
        if (disposed) return;
        if (typeof window === "undefined") return;
        if (contextualPrefetchRetryTimer !== null) return;
        if (contextualPrefetchRetryAttempts >= 3) return;
        contextualPrefetchRetryAttempts += 1;
        const delayMs = 1200 * contextualPrefetchRetryAttempts;
        contextualPrefetchRetryTimer = window.setTimeout(() => {
            contextualPrefetchRetryTimer = null;
            if (disposed) return;
            void ensureRenderer();
        }, delayMs);
    };

    const isCurrentRenderer = (target: ShaderRenderer, generation: number) =>
        !disposed && renderer === target && rendererGeneration === generation;

    const renderController = createShaderPreviewRenderController({
        isCurrentRenderer,
        onRendered: () => props.onRendered,
        onPresented: () => {
            clearContextualPrefetchRetry();
            contextualPrefetchRetryAttempts = 0;
            setHasRenderedThisMount(true);
        },
    });

    const disposeRenderer = () => {
        rendererRequestSeq++;
        rendererGeneration++;
        inputImageRequestSeq++;
        renderController.invalidate();
        parameterTextureRequestSeq.clear();
        paramsNeedFullReapply = true;
        prevParamsRef.current = {};
        lastInputSrc = "";
        setHasRenderedThisMount(false);
        const rendererToDispose = renderer;
        const artId = rendererArtId;
        const unitId = rendererUnitId;
        renderer = null;
        rendererArtId = "";
        rendererUnitId = "";
        if (rendererToDispose) {
            rendererToDispose.setTextureLoadHandler(undefined);
            if (artId) {
                shaderCache.disposeRenderer(artId, unitId, rendererToDispose);
            } else {
                rendererToDispose.dispose();
            }
        }
    };

    const loadInputImage = (
        src: string,
        targetRenderer: ShaderRenderer,
        generation: number,
    ) => {
        if (!isCurrentRenderer(targetRenderer, generation) || src.length === 0 || src === lastInputSrc) {
            return;
        }

        lastInputSrc = src;
        const requestSeq = ++inputImageRequestSeq;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            if (
                !isCurrentRenderer(targetRenderer, generation)
                || requestSeq !== inputImageRequestSeq
                || (props.inputImageSrc || "") !== src
            ) {
                return;
            }
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            if (targetRenderer.loadTexture("input", img) === false) return;
            setInputImageSize({ width, height });
            props.onIntrinsicSizeChange?.({ w: width, h: height });
            renderController.renderRenderer(targetRenderer, generation);
        };
        img.onerror = () => {
            if (!isCurrentRenderer(targetRenderer, generation) || requestSeq !== inputImageRequestSeq) {
                return;
            }
            console.warn("[ShaderPreview] Failed to load input image for shader preview");
        };
        const imageUrl = resolveShaderBrowserImageUrl(src);
        if (!imageUrl) {
            console.warn("[ShaderPreview] Rejected unsafe input image source");
            return;
        }
        img.src = imageUrl;
    };

    const applyCurrentParamsToRenderer = (
        targetRenderer: ShaderRenderer,
        generation: number,
        force: boolean,
    ) => {
        if (!isCurrentRenderer(targetRenderer, generation)) return;

        const params = props.params;
        const prevParams = prevParamsRef.current;
        let shouldRender = false;

        for (const key of Object.keys(prevParams)) {
            if (!(key in params)) {
                parameterTextureRequestSeq.set(key, (parameterTextureRequestSeq.get(key) ?? 0) + 1);
                targetRenderer.removeTexture(key);
                delete prevParams[key];
            }
        }

        for (const [key, value] of Object.entries(params)) {
            if (key.startsWith("__") || key === "reference") continue;
            if (!force && Object.is(prevParams[key], value)) continue;

            const previousValue = prevParams[key];
            prevParams[key] = value;
            const requestSeq = (parameterTextureRequestSeq.get(key) ?? 0) + 1;
            parameterTextureRequestSeq.set(key, requestSeq);
            if (
                typeof previousValue === "string"
                && (typeof value !== "string" || value.length === 0)
            ) {
                targetRenderer.removeTexture(key);
            }

            if (typeof value === "number") {
                targetRenderer.setUniform(key, value);
                shouldRender = true;
            } else if (typeof value === "boolean") {
                targetRenderer.setUniform(key, value ? 1 : 0);
                shouldRender = true;
            } else if (typeof value === "string" && value.length > 0) {
                const src = props.resolveUnitImage?.(value) || value;
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    const currentValue = props.params[key];
                    const currentSrc = typeof currentValue === "string"
                        ? props.resolveUnitImage?.(currentValue) || currentValue
                        : "";
                    if (
                        !isCurrentRenderer(targetRenderer, generation)
                        || parameterTextureRequestSeq.get(key) !== requestSeq
                        || currentSrc !== src
                    ) {
                        return;
                    }
                    if (targetRenderer.loadTexture(key, img) === false) return;
                    renderController.renderRenderer(targetRenderer, generation);
                };
                img.onerror = () => {
                    // Non-image string params are ignored.
                };
                const imageUrl = resolveShaderBrowserImageUrl(src);
                if (imageUrl) img.src = imageUrl;
            } else if (typeof value === "string") {
                targetRenderer.removeTexture(key);
            }
        }

        if (shouldRender) {
            if (force) {
                renderController.renderRenderer(targetRenderer, generation);
            } else {
                renderController.scheduleRendererRender(targetRenderer, generation);
            }
        }
    };

    const installRenderer = (
        nextRenderer: ShaderRenderer,
        artId: string,
        unitId: string,
        inputSrc: string,
    ) => {
        const rendererChanged = renderer !== nextRenderer;
        if (rendererChanged && renderer) {
            disposeRenderer();
        }
        if (rendererChanged) {
            renderer = nextRenderer;
            rendererArtId = artId;
            rendererUnitId = unitId;
            rendererGeneration++;
            lastInputSrc = "";
            prevParamsRef.current = {};
            paramsNeedFullReapply = true;
        }

        const generation = rendererGeneration;
        nextRenderer.setTextureLoadHandler(() => {
            if (isCurrentRenderer(nextRenderer, generation)) {
                renderController.renderRenderer(nextRenderer, generation);
            }
        });
        loadInputImage(inputSrc, nextRenderer, generation);
        applyCurrentParamsToRenderer(nextRenderer, generation, paramsNeedFullReapply);
        if (isCurrentRenderer(nextRenderer, generation)) {
            paramsNeedFullReapply = false;
        }
    };

    const ensureRenderer = async () => {
        if (disposed || !canvasRef) return;

        const artId = props.artId;
        const unitId = props.unitId;
        const inputSrc = props.inputImageSrc || "";
        const referenceSrc = props.referenceImageSrc || "";
        const requiresReference = !!props.requiresReference;

        if (requiresReference && referenceSrc.length === 0) {
            disposeRenderer();
            lastShaderContextKey = "";
            return;
        }

        const seq = ++rendererRequestSeq;
        const shaderContextKey = [
            artId,
            requiresReference ? inputSrc : "",
            requiresReference ? referenceSrc : "",
        ].join("|");
        const shouldRefreshContextualShader = requiresReference && shaderContextKey !== lastShaderContextKey;

        if (shouldRefreshContextualShader) {
            if (!isTauriRuntimeAvailable()) return;
            const shader = await shaderCache.prefetchShader(
                artId,
                true,
                inputSrc,
                referenceSrc,
            );
            if (disposed || seq !== rendererRequestSeq || !canvasRef) return;
            if (!shader || shaderHasIncompleteSupportTextures(shader)) {
                disposeRenderer();
                lastShaderContextKey = "";
                lastInputSrc = "";
                renderController.resetPublishedDataUrl();
                scheduleContextualPrefetchRetry();
                return;
            }
            clearContextualPrefetchRetry();
            contextualPrefetchRetryAttempts = 0;
            disposeRenderer();
            lastShaderContextKey = shaderContextKey;
            lastInputSrc = "";
            renderController.resetPublishedDataUrl();
        } else if (!shaderCache.hasShaderCode(artId)) {
            if (!isTauriRuntimeAvailable()) return;
            const shader = await shaderCache.prefetchShader(artId);
            if (disposed || seq !== rendererRequestSeq || !canvasRef || !shader) return;
        }

        if (disposed || !canvasRef) return;
        const nextRenderer = shaderCache.getRenderer(artId, unitId, canvasRef);
        if (!nextRenderer) return;
        installRenderer(nextRenderer, artId, unitId, inputSrc);
    };

    const canvasPlacement = createMemo(() => {
        const source = inputImageSize() || fallbackPreviewSize();
        if (!source) {
            return {
                left: 0,
                top: 0,
                width: props.width,
                height: props.height,
            };
        }

        return computeContainFitPlacement(
            { width: props.width, height: props.height },
            source,
        );
    });

    onCleanup(() => {
        disposed = true;
        fallbackRecoveryRequestSeq++;
        clearContextualPrefetchRetry();
        disposeRenderer();
    });

    createEffect(() => {
        const inputSrc = props.inputImageSrc;
        const referenceSrc = props.referenceImageSrc;
        const requiresReference = props.requiresReference;
        const holdFallbackPreview = props.holdFallbackPreview;
        const reactiveResetKey = [
            props.unitId,
            props.artId,
            inputSrc || "",
            referenceSrc || "",
            requiresReference ? "1" : "0",
            holdFallbackPreview ? "1" : "0",
        ].join("|");
        void inputSrc;
        void referenceSrc;
        void requiresReference;
        void holdFallbackPreview;
        if (reactiveResetKey === lastReactiveResetKey) {
            return;
        }
        lastReactiveResetKey = reactiveResetKey;
        clearContextualPrefetchRetry();
        contextualPrefetchRetryAttempts = 0;
        rendererGeneration++;
        inputImageRequestSeq++;
        paramsNeedFullReapply = true;
        setHasRenderedThisMount(false);
        setInputImageSize(null);
        setFallbackPreviewSize(null);
        lastInputSrc = "";
        void ensureRenderer();
    });

    createEffect(() => {
        const fallbackPreviewSrc = props.fallbackPreviewSrc;
        void fallbackPreviewSrc;
        fallbackRecoveryRequestSeq++;
        setFallbackPreviewSrcOverride(undefined);
        lastFallbackRecoveryAttemptSrc = "";
        if (!hasRenderedThisMount()) {
            setFallbackPreviewSize(null);
        }
    });

    const effectiveFallbackPreviewSrc = createMemo(
        () => fallbackPreviewSrcOverride() || props.fallbackPreviewSrc,
    );
    const effectiveFallbackPreviewUrl = createMemo(() => {
        const src = effectiveFallbackPreviewSrc();
        return src ? resolveShaderBrowserImageUrl(src) : undefined;
    });

    createEffect(() => {
        void props.params;
        const targetRenderer = renderer;
        if (!targetRenderer) return;
        applyCurrentParamsToRenderer(targetRenderer, rendererGeneration, false);
    });

    return (
        <>
            <Show when={effectiveFallbackPreviewUrl() && (!hasRenderedThisMount() || !!props.holdFallbackPreview)}>
                <img
                    data-shader-fallback-preview="true"
                    src={effectiveFallbackPreviewUrl()!}
                    alt=""
                    draggable={false}
                    onLoad={(event) => {
                        const image = event.currentTarget;
                        if (!(image instanceof HTMLImageElement)) return;
                        const width = image.naturalWidth || image.width;
                        const height = image.naturalHeight || image.height;
                        if (!isShaderImageSizeWithinBudget(width, height)) {
                            image.removeAttribute("src");
                            setFallbackPreviewSize(null);
                            console.warn("[ShaderPreview] Rejected fallback preview outside the shader image budget");
                            return;
                        }
                        setFallbackPreviewSize({ width, height });
                        props.onIntrinsicSizeChange?.({ w: width, h: height });
                    }}
                    onError={async () => {
                        const originalSrc = props.fallbackPreviewSrc;
                        if (!originalSrc || !isLikelyLocalFilePath(originalSrc)) {
                            return;
                        }
                        if (fallbackPreviewSrcOverride() || lastFallbackRecoveryAttemptSrc === originalSrc) {
                            return;
                        }
                        lastFallbackRecoveryAttemptSrc = originalSrc;
                        const requestSeq = ++fallbackRecoveryRequestSeq;
                        try {
                            const recovered = await api.readImageFromPath(originalSrc);
                            if (
                                disposed
                                || requestSeq !== fallbackRecoveryRequestSeq
                                || props.fallbackPreviewSrc !== originalSrc
                                || fallbackPreviewSrcOverride()
                                || !recovered
                                || !recovered.startsWith("data:image/")
                            ) {
                                return;
                            }
                            setFallbackPreviewSrcOverride(recovered);
                        } catch (error) {
                            if (!disposed && requestSeq === fallbackRecoveryRequestSeq) {
                                console.warn("[ShaderPreview] Failed to recover file-backed fallback preview", error);
                            }
                        }
                    }}
                    style={{
                        position: "absolute",
                        display: "block",
                        left: `${canvasPlacement().left}px`,
                        top: `${canvasPlacement().top}px`,
                        width: `${canvasPlacement().width}px`,
                        height: `${canvasPlacement().height}px`,
                        "object-fit": "fill",
                        opacity: props.opacity ?? 1.0,
                    }}
                />
            </Show>
            <canvas
                id={`shader-canvas-${props.unitId}`}
                ref={canvasRef!}
                style={{
                    position: "absolute",
                    display: "block",
                    left: `${canvasPlacement().left}px`,
                    top: `${canvasPlacement().top}px`,
                    width: `${canvasPlacement().width}px`,
                    height: `${canvasPlacement().height}px`,
                    opacity: props.opacity ?? 1.0
                }}
            />
        </>
    );
};
