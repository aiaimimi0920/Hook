/**
 * ShaderPreview - WebGL canvas component for Shader Art real-time preview.
 */

import { Component, createEffect, onCleanup, onMount } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauriRuntimeAvailable } from "../services/api";
import { shaderCache } from "../services/shaderCache";
import { ShaderRenderer } from "./ShaderRenderer";

interface Props {
    unitId: string;
    artId: string;
    artPath?: string;
    params: Record<string, any>;
    inputImageSrc?: string;
    referenceImageSrc?: string;
    requiresReference?: boolean;
    width: number;
    height: number;
    opacity?: number;
    onRendered?: (dataUrl: string) => void;
    resolveUnitImage?: (unitId: string) => string | undefined;
}

export const ShaderPreview: Component<Props> = (props) => {
    let canvasRef: HTMLCanvasElement | undefined;
    let renderer: ShaderRenderer | null = null;
    let rendererRequestSeq = 0;
    let renderExportSeq = 0;
    let lastShaderContextKey = "";
    let lastInputSrc = "";
    let lastRenderedDataUrl = "";

    const toBrowserImageUrl = (src: string) => {
        if (src.startsWith("data:") || src.startsWith("http") || !isTauriRuntimeAvailable()) {
            return src;
        }
        return convertFileSrc(src);
    };

    const disposeRenderer = () => {
        renderExportSeq++;
        if (renderer && props.artId) {
            shaderCache.disposeRenderer(props.artId, props.unitId);
            renderer = null;
        }
    };

    const loadInputImage = (src: string) => {
        if (!renderer || src.length === 0 || src === lastInputSrc) return;

        lastInputSrc = src;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            renderer?.loadTexture("input", img);
            render();
        };
        img.onerror = () => {
            console.warn("[ShaderPreview] Failed to load input image for shader preview");
        };
        img.src = toBrowserImageUrl(src);
    };

    const ensureRenderer = async () => {
        if (!canvasRef) return;

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
            props.artId,
            props.artPath || "",
            requiresReference ? inputSrc : "",
            requiresReference ? referenceSrc : "",
        ].join("|");
        const shouldRefreshContextualShader = requiresReference && shaderContextKey !== lastShaderContextKey;

        if (shouldRefreshContextualShader) {
            if (!isTauriRuntimeAvailable()) return;
            const shader = await shaderCache.prefetchShader(
                props.artId,
                props.artPath,
                true,
                inputSrc,
                referenceSrc,
            );
            if (seq !== rendererRequestSeq || !shader) return;
            disposeRenderer();
            lastShaderContextKey = shaderContextKey;
            lastInputSrc = "";
            lastRenderedDataUrl = "";
        } else if (!shaderCache.hasShaderCode(props.artId)) {
            if (!isTauriRuntimeAvailable()) return;
            const shader = await shaderCache.prefetchShader(props.artId, props.artPath);
            if (seq !== rendererRequestSeq || !shader) return;
        }

        renderer = shaderCache.getRenderer(props.artId, props.unitId, canvasRef);
        if (!renderer) return;

        renderer.setTextureLoadHandler(() => render());
        loadInputImage(inputSrc);
    };

    onMount(() => {
        void ensureRenderer();
    });

    onCleanup(() => {
        disposeRenderer();
    });

    createEffect(() => {
        const inputSrc = props.inputImageSrc;
        const referenceSrc = props.referenceImageSrc;
        const artPath = props.artPath;
        const requiresReference = props.requiresReference;
        void inputSrc;
        void referenceSrc;
        void artPath;
        void requiresReference;
        void ensureRenderer();
    });

    const prevParamsRef: { current: Record<string, any> } = { current: {} };

    createEffect(() => {
        const params = props.params;
        if (!renderer) return;

        const prevParams = prevParamsRef.current;
        let shouldRender = false;

        for (const [key, value] of Object.entries(params)) {
            if (key.startsWith("__")) continue;
            if (key === "reference") continue;
            if (prevParams[key] === value) continue;

            prevParams[key] = value;

            if (typeof value === "number") {
                renderer.setUniform(key, value);
                shouldRender = true;
            } else if (typeof value === "boolean") {
                renderer.setUniform(key, value ? 1 : 0);
                shouldRender = true;
            } else if (typeof value === "string" && value.length > 0) {
                const src = props.resolveUnitImage?.(value) || value;
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    renderer?.loadTexture(key, img);
                    render();
                };
                img.onerror = () => {
                    // Non-image string params are ignored.
                };
                img.src = toBrowserImageUrl(src);
            }
        }

        if (shouldRender) {
            render();
        }
    });

    const emitRenderedAsync = () => {
        if (!props.onRendered || !renderer) return;

        const canvas = renderer.getCanvas();
        const seq = ++renderExportSeq;
        canvas.toBlob((blob) => {
            if (!blob || seq !== renderExportSeq) return;

            const reader = new FileReader();
            reader.onloadend = () => {
                if (seq !== renderExportSeq || typeof reader.result !== "string") return;

                const dataUrl = reader.result;
                if (dataUrl !== lastRenderedDataUrl) {
                    lastRenderedDataUrl = dataUrl;
                    props.onRendered?.(dataUrl);
                }
            };
            reader.readAsDataURL(blob);
        }, "image/png");
    };

    const render = () => {
        if (!renderer || !renderer.isReady()) return;

        renderer.render();
        emitRenderedAsync();
    };

    return (
        <canvas
            id={`shader-canvas-${props.unitId}`}
            ref={canvasRef!}
            width={props.width}
            height={props.height}
            style={{
                width: "100%",
                height: "100%",
                "object-fit": "fill",
                opacity: props.opacity ?? 1.0
            }}
        />
    );
};
