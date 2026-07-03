import { createEmptyAnnotationState, createEmptyImageEditState } from "./stickerEditing";
import type { StickerAnnotationState } from "../types/stickerEditing";
import type { Unit } from "../types/unit";

export type StickerRasterizeScope = "selected" | "all";

export interface RasterizedStickerLayerSources {
    baseLayerSrc: string;
    rasterizedAnnotationLayerSrc: string;
    previewSrc: string;
}

export const getRasterizableAnnotationIds = (
    unit: Unit,
    scope: StickerRasterizeScope,
    selectedAnnotationIdOrIds: string | string[] | null,
): string[] => {
    const elements = unit.data.annotationState?.elements || [];
    if (scope === "all") {
        return elements.map((annotation) => annotation.id);
    }

    if (Array.isArray(selectedAnnotationIdOrIds)) {
        if (selectedAnnotationIdOrIds.length === 0) {
            return [];
        }

        const existingIds = new Set(elements.map((annotation) => annotation.id));
        const filteredIds: string[] = [];
        const seenIds = new Set<string>();
        for (const annotationId of selectedAnnotationIdOrIds) {
            if (!existingIds.has(annotationId) || seenIds.has(annotationId)) {
                continue;
            }
            seenIds.add(annotationId);
            filteredIds.push(annotationId);
        }
        return filteredIds;
    }

    if (!selectedAnnotationIdOrIds) {
        return [];
    }

    return elements.some((annotation) => annotation.id === selectedAnnotationIdOrIds)
        ? [selectedAnnotationIdOrIds]
        : [];
};

export const createRasterizedStickerData = (
    unit: Unit,
    sources: RasterizedStickerLayerSources,
    annotationIds: string[],
): Partial<Unit["data"]> => {
    const rasterizedIdSet = new Set(annotationIds);
    const annotationState: StickerAnnotationState =
        unit.data.annotationState || createEmptyAnnotationState();

    return {
        src: sources.baseLayerSrc,
        previewSrc: sources.previewSrc,
        rasterizedAnnotationLayerSrc: sources.rasterizedAnnotationLayerSrc,
        resultHandle: undefined,
        filePath: undefined,
        imageEditState: createEmptyImageEditState(),
        annotationState: {
            ...annotationState,
            elements: annotationState.elements.filter(
                (annotation) => !rasterizedIdSet.has(annotation.id),
            ),
        },
    };
};
