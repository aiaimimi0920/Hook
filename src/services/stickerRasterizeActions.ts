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
import {
    createStickerAsyncEditGuard,
    isStickerAsyncEditGuardCurrent,
} from "./stickerAsyncEditGuard";

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

    let committed = false;
    try {
        const currentUnit = params.currentUnit;
        const requestGuard = createStickerAsyncEditGuard(currentUnit);
        const historySnapshot = captureStickerEditSnapshot(currentUnit, { includeImageData: true });
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
        const latestUnit = graphStore.units.find((unit) => unit.id === params.unitId);
        if (!isStickerAsyncEditGuardCurrent(requestGuard, latestUnit)) return false;

        uiActions.pushStickerHistory(
            params.unitId,
            historySnapshot,
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
        committed = true;
        await syncService.performWorkflowSync();
        return true;
    } catch (error) {
        console.error("Rasterize sticker annotations failed", error);
        // A backend sync failure does not roll back the already-applied local
        // mutation. Report the local commit so callers clear stale selection.
        return committed;
    }
};
