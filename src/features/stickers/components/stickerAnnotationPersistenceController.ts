import type { Accessor } from "solid-js";

import { captureStickerEditSnapshot } from "../services/stickerHistory";
import { syncService } from "../../workspace/services/syncService";
import { graphStore } from "../../workspace/state/graphStore";
import { uiActions } from "../../workspace/state/uiStore";
import type {
    StickerAnnotation,
    StickerAnnotationState,
} from "../types/stickerEditing";
import type { Unit } from "../../workspace/types/unit";

interface StickerAnnotationPersistenceOptions {
    unitId: Accessor<string>;
    unit: Accessor<Unit | undefined>;
    annotationState: Accessor<StickerAnnotationState>;
}

// Graph mutation, history capture and backend sync form one commit boundary.
// Keeping them together prevents pointer/render owners from bypassing history
// or persisting preview-only state during high-frequency interaction.
export const createStickerAnnotationPersistence = (
    options: StickerAnnotationPersistenceOptions,
) => {
    const propagateStickerEditFromCurrentUnit = () => {
        graphStore.actions.propagateStickerEditsFrom(options.unitId());
    };

    const patchUnitData = async (
        patch: Partial<Unit["data"]>,
    ) => {
        graphStore.actions.updateStickerEditData(options.unitId(), patch);
        propagateStickerEditFromCurrentUnit();
        await syncService.performWorkflowSync();
    };

    const rememberCurrentState = (includeImageData = false) => {
        const currentUnit = options.unit();
        if (!currentUnit) return;
        uiActions.pushStickerHistory(
            options.unitId(),
            captureStickerEditSnapshot(
                currentUnit,
                includeImageData ? { includeImageData: true } : undefined,
            ),
        );
    };

    const commitAnnotationElements = async (elements: StickerAnnotation[]) => {
        rememberCurrentState();
        await patchUnitData({
            annotationState: {
                ...options.annotationState(),
                elements,
            },
        });
    };

    const commitAnnotation = async (
        annotation: StickerAnnotation,
        nextSerialCounter?: number,
    ) => {
        rememberCurrentState();
        await patchUnitData({
            annotationState: {
                elements: [...options.annotationState().elements, annotation],
                serialCounter: nextSerialCounter ?? options.annotationState().serialCounter,
            },
        });
    };

    return {
        commitAnnotation,
        commitAnnotationElements,
        patchUnitData,
        rememberCurrentState,
    };
};
