import type { Accessor } from "solid-js";

import { captureStickerEditSnapshot } from "../services/stickerHistory";
import { syncService } from "../services/syncService";
import { graphStore } from "../store/graphStore";
import { uiActions } from "../store/uiStore";
import type {
    StickerAnnotation,
    StickerAnnotationState,
} from "../types/stickerEditing";
import type { Unit } from "../types/unit";

interface StickerAnnotationPersistenceOptions {
    unitId: Accessor<string>;
    unit: Accessor<Unit | undefined>;
    annotationState: Accessor<StickerAnnotationState>;
}

interface PatchOptions {
    propagateEdit?: boolean;
    markLocalEdit?: boolean;
}

// Graph mutation, history capture and backend sync form one commit boundary.
// Keeping them together prevents pointer/render owners from bypassing history
// or persisting preview-only state during high-frequency interaction.
export const createStickerAnnotationPersistence = (
    options: StickerAnnotationPersistenceOptions,
) => {
    const patchUnitDataLocally = (patch: Partial<Unit["data"]>) => {
        graphStore.actions.updateUnitData(options.unitId(), patch);
    };

    const propagateStickerEditFromCurrentUnit = () => {
        graphStore.actions.propagateStickerEditsFrom(options.unitId());
    };

    const patchUnitData = async (
        patch: Partial<Unit["data"]>,
        patchOptions: PatchOptions = {},
    ) => {
        if (patchOptions.propagateEdit) {
            graphStore.actions.updateStickerEditData(options.unitId(), patch, {
                markLocalEdit: patchOptions.markLocalEdit,
            });
            propagateStickerEditFromCurrentUnit();
        } else {
            patchUnitDataLocally(patch);
        }
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
        }, { propagateEdit: true });
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
        }, { propagateEdit: true });
    };

    return {
        commitAnnotation,
        commitAnnotationElements,
        patchUnitData,
        rememberCurrentState,
    };
};
