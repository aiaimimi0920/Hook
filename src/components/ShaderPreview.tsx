/**
 * ShaderPreview - WebGL canvas component for Shader Art real-time preview.
 */

import { Component, createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, isTauriRuntimeAvailable } from "../services/api";
import { isLikelyLocalFilePath } from "../services/imageSource";
import { shaderCache } from "../services/shaderCache";
import { ShaderRenderer, type ShaderSuccessResponse } from "./ShaderRenderer";
import { computeContainFitPlacement } from "../services/stickerEditing";

interface Props {
    unitId: string;
    artId: string;
    artPath?: string;
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
    let renderExportSeq = 0;
    let lastShaderContextKey = "";
    let lastInputSrc = "";
    let lastRenderedDataUrl = "";
    let lastReactiveResetKey = "";
    let lastFallbackRecoveryAttemptSrc = "";
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

    const toBrowserImageUrl = (src: string) => {
        if (src.startsWith("data:") || src.startsWith("http") || !isTauriRuntimeAvailable()) {
            return src;
        }
        return convertFileSrc(src);
    };

    const disposeRenderer = () => {
        rendererRequestSeq++;
        rendererGeneration++;
        inputImageRequestSeq++;
        renderExportSeq++;
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

    const isCurrentRenderer = (target: ShaderRenderer, generation: number) =>
        !disposed && renderer === target && rendererGeneration === generation;

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
            if (width > 0 && height > 0) {
                setInputImageSize({ width, height });
                props.onIntrinsicSizeChange?.({ w: width, h: height });
            }
            targetRenderer.loadTexture("input", img);
            renderRenderer(targetRenderer, generation);
        };
        img.onerror = () => {
            if (!isCurrentRenderer(targetRenderer, generation) || requestSeq !== inputImageRequestSeq) {
                return;
            }
            console.warn("[ShaderPreview] Failed to load input image for shader preview");
        };
        img.src = toBrowserImageUrl(src);
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
                delete prevParams[key];
            }
        }

        for (const [key, value] of Object.entries(params)) {
            if (key.startsWith("__") || key === "reference") continue;
            if (!force && Object.is(prevParams[key], value)) continue;

            prevParams[key] = value;
            const requestSeq = (parameterTextureRequestSeq.get(key) ?? 0) + 1;
            parameterTextureRequestSeq.set(key, requestSeq);

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
                    targetRenderer.loadTexture(key, img);
                    renderRenderer(targetRenderer, generation);
                };
                img.onerror = () => {
                    // Non-image string params are ignored.
                };
                img.src = toBrowserImageUrl(src);
            }
        }

        if (shouldRender) {
            renderRenderer(targetRenderer, generation);
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
                renderRenderer(nextRenderer, generation);
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
        const artPath = props.artPath;
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
            artPath || "",
            requiresReference ? inputSrc : "",
            requiresReference ? referenceSrc : "",
        ].join("|");
        const shouldRefreshContextualShader = requiresReference && shaderContextKey !== lastShaderContextKey;

        if (shouldRefreshContextualShader) {
            if (!isTauriRuntimeAvailable()) return;
            const shader = await shaderCache.prefetchShader(
                artId,
                artPath,
                true,
                inputSrc,
                referenceSrc,
            );
            if (disposed || seq !== rendererRequestSeq || !canvasRef) return;
            if (!shader || shaderHasIncompleteSupportTextures(shader)) {
                disposeRenderer();
                lastShaderContextKey = "";
                lastInputSrc = "";
                lastRenderedDataUrl = "";
                scheduleContextualPrefetchRetry();
                return;
            }
            clearContextualPrefetchRetry();
            contextualPrefetchRetryAttempts = 0;
            disposeRenderer();
            lastShaderContextKey = shaderContextKey;
            lastInputSrc = "";
            lastRenderedDataUrl = "";
        } else if (!shaderCache.hasShaderCode(artId)) {
            if (!isTauriRuntimeAvailable()) return;
            const shader = await shaderCache.prefetchShader(artId, artPath);
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
        clearContextualPrefetchRetry();
        disposeRenderer();
    });

    createEffect(() => {
        const inputSrc = props.inputImageSrc;
        const referenceSrc = props.referenceImageSrc;
        const artPath = props.artPath;
        const requiresReference = props.requiresReference;
        const holdFallbackPreview = props.holdFallbackPreview;
        const reactiveResetKey = [
            props.unitId,
            props.artId,
            inputSrc || "",
            referenceSrc || "",
            artPath || "",
            requiresReference ? "1" : "0",
            holdFallbackPreview ? "1" : "0",
        ].join("|");
        void inputSrc;
        void referenceSrc;
        void artPath;
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
        setFallbackPreviewSrcOverride(undefined);
        lastFallbackRecoveryAttemptSrc = "";
        if (!hasRenderedThisMount()) {
            setFallbackPreviewSize(null);
        }
    });

    const effectiveFallbackPreviewSrc = createMemo(
        () => fallbackPreviewSrcOverride() || props.fallbackPreviewSrc,
    );

    createEffect(() => {
        void props.params;
        const targetRenderer = renderer;
        if (!targetRenderer) return;
        applyCurrentParamsToRenderer(targetRenderer, rendererGeneration, false);
    });

    const emitRenderedAsync = (targetRenderer: ShaderRenderer, generation: number) => {
        if (!props.onRendered || !isCurrentRenderer(targetRenderer, generation)) return;

        const canvas = targetRenderer.getCanvas();
        const seq = ++renderExportSeq;
        canvas.toBlob((blob) => {
            if (!blob || seq !== renderExportSeq || !isCurrentRenderer(targetRenderer, generation)) return;

            const reader = new FileReader();
            reader.onloadend = () => {
                if (
                    seq !== renderExportSeq
                    || !isCurrentRenderer(targetRenderer, generation)
                    || typeof reader.result !== "string"
                ) {
                    return;
                }

                const dataUrl = reader.result;
                if (dataUrl !== lastRenderedDataUrl) {
                    lastRenderedDataUrl = dataUrl;
                    props.onRendered?.(dataUrl);
                }
            };
            reader.readAsDataURL(blob);
        }, "image/png");
    };

    const renderRenderer = (targetRenderer: ShaderRenderer, generation: number) => {
        if (!isCurrentRenderer(targetRenderer, generation) || !targetRenderer.isReady()) return;

        const canPresentOutput =
            typeof (targetRenderer as ShaderRenderer & { canPresentOutput?: () => boolean }).canPresentOutput === "function"
                ? (targetRenderer as ShaderRenderer & { canPresentOutput: () => boolean }).canPresentOutput()
                : targetRenderer.isReady();
        if (!canPresentOutput) return;

        targetRenderer.render();
        const shouldKeepFallbackForTransparentRestore =
            !!effectiveFallbackPreviewSrc() &&
            (!hasRenderedThisMount() || !!props.holdFallbackPreview) &&
            typeof (targetRenderer as ShaderRenderer & { hasVisibleContent?: () => boolean }).hasVisibleContent === "function" &&
            !(targetRenderer as ShaderRenderer & { hasVisibleContent: () => boolean }).hasVisibleContent();
        if (shouldKeepFallbackForTransparentRestore) {
            disposeRenderer();
            lastShaderContextKey = "";
            lastInputSrc = "";
            lastRenderedDataUrl = "";
            scheduleContextualPrefetchRetry();
            return;
        }
        clearContextualPrefetchRetry();
        contextualPrefetchRetryAttempts = 0;
        setHasRenderedThisMount(true);
        emitRenderedAsync(targetRenderer, generation);
    };

    return (
        <>
            <Show when={effectiveFallbackPreviewSrc() && (!hasRenderedThisMount() || !!props.holdFallbackPreview)}>
                <img
                    data-shader-fallback-preview="true"
                    src={toBrowserImageUrl(effectiveFallbackPreviewSrc()!)}
                    alt=""
                    draggable={false}
                    onLoad={(event) => {
                        const image = event.currentTarget;
                        if (!(image instanceof HTMLImageElement)) return;
                        const width = image.naturalWidth || image.width;
                        const height = image.naturalHeight || image.height;
                        if (width <= 0 || height <= 0) return;
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
                        try {
                            const recovered = await api.readImageFromPath(originalSrc);
                            if (!recovered || !recovered.startsWith("data:")) {
                                return;
                            }
                            setFallbackPreviewSrcOverride(recovered);
                        } catch (error) {
                            console.warn("[ShaderPreview] Failed to recover file-backed fallback preview", error);
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
