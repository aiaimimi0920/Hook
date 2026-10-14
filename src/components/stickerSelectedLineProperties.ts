import { createMemo } from "solid-js";
import { graphStore } from "../store/graphStore";
import { selectedStickerAnnotationId, selectedStickerAnnotationIds, uiActions } from "../store/uiStore";
import { captureStickerEditSnapshot } from "../services/stickerHistory";
import { syncService } from "../services/syncService";
import type { StickerLineAnnotation, StickerToolSettings } from "../types/stickerEditing";

export type LinePropertyValues = Pick<StickerToolSettings, "lineStrokeColor" | "strokeWidth" | "shapeStrokeDashPattern" | "lineArrowEnabled">;

/** Selected line styles commit through the same graph/history boundary as reshaping. */
export const createSelectedLineProperties = (unitId: () => string, enabled: () => boolean) => {
    const selected = createMemo(() => {
        if (!enabled() || selectedStickerAnnotationIds.length > 1) return undefined;
        const unit = graphStore.units.find((item) => item.id === unitId());
        const annotation = unit?.data.annotationState?.elements.find((item) => item.id === selectedStickerAnnotationId());
        return annotation && (annotation.type === "bezier" || annotation.type === "line" || annotation.type === "arrow")
            ? annotation as StickerLineAnnotation : undefined;
    });
    const values = createMemo<LinePropertyValues | undefined>(() => {
        const line = selected();
        return line ? {
            lineStrokeColor: line.style.color,
            strokeWidth: line.style.width,
            shapeStrokeDashPattern: line.style.dashPattern ?? "solid",
            lineArrowEnabled: line.type === "arrow" || !!line.showArrowHead,
        } : undefined;
    });
    const patch = (changes: Partial<LinePropertyValues>) => {
        const line = selected();
        const unit = graphStore.units.find((item) => item.id === unitId());
        if (!line || !unit?.data.annotationState) return;
        const next: StickerLineAnnotation = {
            ...line,
            type: line.type === "bezier" ? "bezier" : (changes.lineArrowEnabled ?? line.type === "arrow") ? "arrow" : "line",
            ...(line.type === "bezier" ? { showArrowHead: changes.lineArrowEnabled ?? line.showArrowHead } : {}),
            style: {
                ...line.style,
                color: changes.lineStrokeColor ?? line.style.color,
                width: changes.strokeWidth ?? line.style.width,
                dashPattern: changes.shapeStrokeDashPattern ?? line.style.dashPattern,
            },
        };
        if (JSON.stringify(next) === JSON.stringify(line)) return;
        uiActions.pushStickerHistory(unit.id, captureStickerEditSnapshot(unit));
        graphStore.actions.updateStickerEditData(unit.id, {
            annotationState: { ...unit.data.annotationState,
                elements: unit.data.annotationState.elements.map((item) => item.id === line.id ? next : item) },
        });
        graphStore.actions.propagateStickerEditsFrom(unit.id);
        void syncService.performWorkflowSync().catch((error) => console.error("[Otter] Failed to sync line properties", error));
    };
    return { selected, values, patch };
};
