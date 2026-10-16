import { Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { api } from "../../../platform/tauri/api";
import { normalizeImageSourceForDisplay } from "../../../platform/tauri/imageSource";
import {
    computeCroppedStickerImageViewport,
    computeMinifiedStickerAnnotationViewport,
    computeMinifiedStickerViewport,
} from "../../stickers/services/stickerEditing";
import { resolveStickerContentFrame } from "../../stickers/services/stickerEditPropagation";
import { DISABLED_PREFIX } from "../model/constants";
import { graphStore } from "../state/graphStore";
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
    const imageContentFrame = () => {
        const unit = options.unit();
        if (!isMinified()) return resolveStickerContentFrame(unit);
        if (unit.type !== "sticker") return { x: 0, y: 0, w: unit.w, h: unit.h };
        // Minifying crops the window, not its image coordinate system. Keep crop,
        // contain margins, flips and propagated content aligned with annotations.
        const saved = unit.data.savedRect;
        const full = saved && Number.isFinite(saved.w) && Number.isFinite(saved.h) && saved.w > 0 && saved.h > 0 ? saved : unit;
        const frame = resolveStickerContentFrame({ ...unit, w: full.w, h: full.h });
        return { ...frame, x: frame.x - (unit.data.cropOffset?.x ?? 0), y: frame.y - (unit.data.cropOffset?.y ?? 0) };
    };
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
