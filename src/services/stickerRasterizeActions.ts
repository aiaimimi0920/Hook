import { graphStore } from "../store/graphStore";
import { uiActions } from "../store/uiStore";
import type { Unit } from "../types/unit";
import { composeRasterizedStickerPreview } from "./stickerBitmapLayers";
import {
    renderStickerBaseLayer,
    renderStickerTransparentAnnotationLayer,
} from "./stickerExport";
import { captureStickerEditSnapshot } from "./stickerHistory";
import {
    createRasterizedStickerData,
    getRasterizableAnnotationIds,
    type StickerRasterizeScope,
} from "./stickerRasterize";
import { syncService } from "./syncService";

export const rasterizeStickerAnnotationsForUnit = async (params: {
    unitId: string;
    currentUnit: Unit;
    scope: StickerRasterizeScope;
    selectedAnnotationId: string | null;
    selectedAnnotationIds?: string[];
}): Promise<boolean> => {
    const annotationIds = getRasterizableAnnotationIds(
        params.currentUnit,
        params.scope,
        params.scope === "selected"
            ? (params.selectedAnnotationIds?.length ? params.selectedAnnotationIds : params.selectedAnnotationId)
            : params.selectedAnnotationId,
    );
    if (annotationIds.length === 0) return false;

    try {
        const currentUnit = params.currentUnit;
        const baseLayerSrc = await renderStickerBaseLayer(currentUnit);
        const rasterizedAnnotationLayerSrc = await renderStickerTransparentAnnotationLayer(
            currentUnit,
            annotationIds,
        );
        const previewSrc = await composeRasterizedStickerPreview(
            baseLayerSrc,
            rasterizedAnnotationLayerSrc,
            { w: currentUnit.w, h: currentUnit.h },
        );
        uiActions.pushStickerHistory(
            params.unitId,
            captureStickerEditSnapshot(currentUnit, { includeImageData: true }),
        );
        graphStore.actions.updateUnitData(
            params.unitId,
            createRasterizedStickerData(
                currentUnit,
                {
                    baseLayerSrc,
                    rasterizedAnnotationLayerSrc,
                    previewSrc,
                },
                annotationIds,
            ),
        );
        await syncService.performWorkflowSync();
        return true;
    } catch (error) {
        console.error("Rasterize sticker annotations failed", error);
        return false;
    }
};
