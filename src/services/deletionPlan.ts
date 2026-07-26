// Pure "what should a delete action target" decision.
//
// Extracted from app.tsx's deleteSelectedUnitOrAnnotation so the precedence
// rules (annotation-delete beats unit-delete; multi-selection beats the single
// selected sticker) can be characterized by tests. The side effects — history
// snapshots, recycle bin, unit removal, UI cleanup, sync — stay in app.tsx and
// switch on the returned plan.

import type { Unit } from "../types/unit";

export type DeletionPlan =
    | { kind: "annotation"; stickerId: string; annotationId: string }
    | { kind: "units"; unitIds: string[] }
    | { kind: "none" };

export interface DeletionPlanInput {
    selectedAnnotationId: string | null | undefined;
    selectedStickerId: string | null | undefined;
    selectedUnitIds: readonly string[];
    units: readonly Unit[];
}

/**
 * Decides what a delete action targets:
 *  1. If a sticker annotation is selected on a sticker that actually carries an
 *     annotation layer, delete just that annotation.
 *  2. Otherwise delete units: the multi-selection if present, else the single
 *     selected sticker.
 *  3. Otherwise nothing.
 */
export const resolveDeletionPlan = (input: DeletionPlanInput): DeletionPlan => {
    const { selectedAnnotationId, selectedStickerId } = input;

    if (selectedAnnotationId && selectedStickerId) {
        const activeUnit = input.units.find((unit) => unit.id === selectedStickerId);
        if (activeUnit?.type === "sticker" && activeUnit.data.annotationState) {
            return {
                kind: "annotation",
                stickerId: selectedStickerId,
                annotationId: selectedAnnotationId,
            };
        }
    }

    const unitIds =
        input.selectedUnitIds.length > 0
            ? [...input.selectedUnitIds]
            : selectedStickerId
              ? [selectedStickerId]
              : [];

    return unitIds.length > 0 ? { kind: "units", unitIds } : { kind: "none" };
};
