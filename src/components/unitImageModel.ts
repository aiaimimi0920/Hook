import { Accessor, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { api } from "../services/api";
import { normalizeImageSourceForDisplay } from "../services/imageSource";
import {
    computeCroppedStickerImageViewport,
    computeMinifiedStickerAnnotationViewport,
    computeMinifiedStickerViewport,
} from "../services/stickerEditing";
import { resolveStickerContentFrame } from "../services/stickerEditPropagation";
import { resolveStickerCompositeBaseImageSrc } from "../services/stickerExport";
import { bakedSyncPreviewCacheRevision, resolveCachedBakedSyncPreview } from "../services/syncImageCache";
import { DISABLED_PREFIX } from "../constants";
import { graphStore } from "../store/graphStore";
import type { Link, Unit } from "../types/unit";

interface NamedPort {
    name: string;
}

interface UnitImageModelOptions {
    unit: Accessor<Unit>;
    params: Accessor<Record<string, unknown>>;
    connectedLinks: Accessor<Link[] | undefined>;
    resolveUnitImage: Accessor<((unitId: string) => string | undefined) | undefined>;
    inputs: Accessor<NamedPort[]>;
    isShaderArt: Accessor<boolean>;
    artId: Accessor<string | undefined>;
    shaderInputSrc: Accessor<string>;
    shaderReferenceSrc: Accessor<string | undefined>;
}

/** Computes display/crop geometry and owns image intrinsic-size tracking. */
export const createUnitImageModel = (options: UnitImageModelOptions) => {
    const [baseImageIntrinsicSize, setBaseImageIntrinsicSize] = createSignal<{ w: number; h: number } | null>(null);
    const [shaderImageIntrinsicSize, setShaderImageIntrinsicSize] = createSignal<{ w: number; h: number } | null>(null);
    const isMinified = () => !!options.unit().data.minified;
    const imageEditState = () => options.unit().data.imageEditState;
    const imageContentFrame = () => isMinified()
        ? { x: 0, y: 0, w: options.unit().w, h: options.unit().h }
        : resolveStickerContentFrame(options.unit());
    const displaySrc = () => {
        const unit = options.unit();
        let resolvedSrc: string | undefined;
        if (unit.type !== "art" && unit.params.image !== DISABLED_PREFIX) {
            const imageInput = options.inputs().find((input) => input.name === "image");
            const link = imageInput
                ? options.connectedLinks()?.find((candidate) => candidate.toPortId === imageInput.name)
                : undefined;
            resolvedSrc = link ? options.resolveUnitImage()?.(link.fromUnitId) : undefined;
            const manualPath = options.params().image_path;
            if (typeof manualPath === "string" && manualPath.startsWith("data:")) {
                resolvedSrc = manualPath;
            }
        }
        resolvedSrc ||= unit.data.previewSrc || unit.data.src || "";
        return normalizeImageSourceForDisplay(resolvedSrc) || "";
    };
    const baseImageSrc = () => options.unit().data.rasterizedAnnotationLayerSrc
        ? normalizeImageSourceForDisplay(options.unit().data.src || displaySrc()) || ""
        : displaySrc();
    const minifiedBakedPreviewSrc = createMemo(() => {
        bakedSyncPreviewCacheRevision();
        const unit = options.unit();
        if (unit.type !== "sticker" || !unit.data.minified) return undefined;
        const displaySrcOverride = resolveStickerCompositeBaseImageSrc({
            unit,
            units: graphStore.units,
            links: graphStore.links,
            capabilities: graphStore.capabilities,
        });
        const cached = resolveCachedBakedSyncPreview(unit, displaySrcOverride ?? null);
        return cached ? normalizeImageSourceForDisplay(cached) || undefined : undefined;
    });
    const shaderViewportSourceKey = () => options.isShaderArt()
        ? `${options.artId() || ""}|${options.shaderInputSrc()}|${options.shaderReferenceSrc() || ""}`
        : "";
    let lastShaderViewportSourceKey = "";
    createEffect(() => {
        void baseImageSrc();
        setBaseImageIntrinsicSize(null);
    });
    createEffect(() => {
        const nextKey = shaderViewportSourceKey();
        if (nextKey === lastShaderViewportSourceKey) return;
        lastShaderViewportSourceKey = nextKey;
        setShaderImageIntrinsicSize(null);
    });
    const handleBaseImageLoad = (event: Event) => {
        const image = event.currentTarget;
        if (!(image instanceof HTMLImageElement)) return;
        const w = image.naturalWidth || image.width;
        const h = image.naturalHeight || image.height;
        if (w > 0 && h > 0) setBaseImageIntrinsicSize({ w, h });
    };
    const fileBackedFallbacksInFlight = new Set<string>();
    let fallbackRequestGeneration = 0;
    const handleFileBackedImageLoadError = async () => {
        const unit = options.unit();
        const filePath = unit.data.filePath;
        const requestKey = `${unit.id}\0${filePath || ""}`;
        if (!filePath || unit.data.previewSrc?.startsWith("data:") || fileBackedFallbacksInFlight.has(requestKey)) return;
        const requestGeneration = ++fallbackRequestGeneration;
        fileBackedFallbacksInFlight.add(requestKey);
        try {
            const fallbackSrc = await api.readImageFromPath(filePath);
            const currentUnit = options.unit();
            if (
                requestGeneration !== fallbackRequestGeneration ||
                currentUnit.id !== unit.id ||
                currentUnit.data.filePath !== filePath ||
                currentUnit.data.previewSrc?.startsWith("data:") ||
                !graphStore.units.some((candidate) => candidate.id === unit.id)
            ) return;
            graphStore.actions.updateUnitData(unit.id, { previewSrc: fallbackSrc });
        } catch (error) {
            console.warn("[UnitView] Failed to load file-backed image fallback", error);
        } finally {
            fileBackedFallbacksInFlight.delete(requestKey);
        }
    };
    onCleanup(() => {
        fallbackRequestGeneration += 1;
        fileBackedFallbacksInFlight.clear();
    });

    return {
        baseImageSrc,
        cornerRadius: () => imageEditState()?.cornerRadius ?? 0,
        croppedImageViewport: () => computeCroppedStickerImageViewport(imageContentFrame(), imageEditState()),
        displaySrc,
        handleBaseImageLoad,
        handleFileBackedImageLoadError,
        imageBorderColor: () => imageEditState()?.borderColor ?? "transparent",
        imageBorderWidth: () => imageEditState()?.borderWidth ?? 0,
        imageContentFrame,
        minifiedAnnotationViewport: () => computeMinifiedStickerAnnotationViewport(
            { w: options.unit().w, h: options.unit().h },
            options.unit().data.savedRect,
            options.unit().data.cropOffset,
        ),
        minifiedBakedPreviewSrc,
        minifiedViewport: () => computeMinifiedStickerViewport(
            { w: options.unit().w, h: options.unit().h },
            options.unit().data.savedRect,
            options.unit().data.cropOffset,
            imageEditState(),
            shaderImageIntrinsicSize() || baseImageIntrinsicSize() || undefined,
        ),
        opacity: () => isMinified()
            ? (options.unit().data.opacityMini ?? 0.9)
            : (options.unit().data.opacityNormal ?? 1),
        setShaderImageIntrinsicSize,
        transform: () => `scale(${imageEditState()?.flippedX ? -1 : 1}, ${imageEditState()?.flippedY ? -1 : 1})`,
    };
};
