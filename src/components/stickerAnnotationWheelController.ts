import type { Accessor } from "solid-js";

import { ShortcutManager } from "../services/shortcuts";
import {
    scaleAnnotationsAroundGroupCenter,
    scaleAnnotationsAroundOwnCenters,
} from "../services/stickerGeometry";
import { uiActions } from "../store/uiStore";
import type {
    StickerAnnotation,
    StickerAnnotationState,
    StickerTransformMode,
} from "../types/stickerEditing";
import type { DraftLine, DraftShape } from "./stickerAnnotationModel";
import {
    applyAnnotationReplacements,
    type ActiveTransformInteraction,
    type ReshapeLineState,
    type ResizeAnnotationState,
} from "./stickerAnnotationTransformController";

interface StickerAnnotationWheelControllerOptions {
    interactionEnabled: Accessor<boolean>;
    usesExistingNodeInteractions: Accessor<boolean>;
    effectiveTransformMode: Accessor<StickerTransformMode>;
    transformInteraction: Accessor<ActiveTransformInteraction | null>;
    reshapeLine: Accessor<ReshapeLineState | null>;
    resizeAnnotation: Accessor<ResizeAnnotationState | null>;
    draftShape: Accessor<DraftShape | null>;
    draftLine: Accessor<DraftLine | null>;
    selectedAnnotationIds: Accessor<string[]>;
    annotationState: Accessor<StickerAnnotationState>;
    commitAnnotationElements: (elements: StickerAnnotation[]) => Promise<void>;
}

// Own modifier-wheel scaling so the layer only wires event handlers and view state.
export const createStickerAnnotationWheelController = (
    options: StickerAnnotationWheelControllerOptions,
) => {
    let disposed = false;
    let commitTail = Promise.resolve();

    const onWheel = async (event: WheelEvent) => {
        if (disposed || !options.interactionEnabled() || !options.usesExistingNodeInteractions()) return;
        const transformMode = options.effectiveTransformMode();
        const scaleAroundOwnCenters = ShortcutManager.isGestureActive(
            event,
            "control_scale_own_center",
        );
        const scaleAroundGroupCenter = ShortcutManager.isGestureActive(event, "control_scale");
        if (
            transformMode !== "select" ||
            (!scaleAroundOwnCenters && !scaleAroundGroupCenter)
        ) return;
        if (
            options.transformInteraction() ||
            options.reshapeLine() ||
            options.resizeAnnotation() ||
            options.draftShape() ||
            options.draftLine()
        ) return;

        const deltaY = event.deltaY;
        if (deltaY === 0) return;
        const annotationIds = options.selectedAnnotationIds();
        if (annotationIds.length < 1) return;
        const idSet = new Set(annotationIds);
        const targetAnnotations = options
            .annotationState()
            .elements.filter((annotation) => idSet.has(annotation.id));
        if (targetAnnotations.length < 1) return;

        event.preventDefault();
        event.stopPropagation();
        const scaleFactor = Math.max(0.5, Math.min(1.5, Math.exp(-deltaY * 0.001)));
        const scale = { x: scaleFactor, y: scaleFactor };
        const task = commitTail.then(async () => {
            if (disposed) return;
            const currentElements = options.annotationState().elements;
            const latestTargetAnnotations = currentElements.filter((annotation) =>
                idSet.has(annotation.id),
            );
            if (latestTargetAnnotations.length < 1) return;
            const transformed =
                scaleAroundOwnCenters && latestTargetAnnotations.length > 1
                    ? scaleAnnotationsAroundOwnCenters(latestTargetAnnotations, scale)
                    : scaleAnnotationsAroundGroupCenter(latestTargetAnnotations, scale);
            const replacements = new Map(
                transformed.map((annotation) => [annotation.id, annotation]),
            );
            await options.commitAnnotationElements(
                applyAnnotationReplacements(currentElements, replacements),
            );
            if (!disposed) uiActions.setSelectedStickerAnnotations(annotationIds);
        });
        commitTail = task.catch(() => undefined);
        await task;
    };

    return {
        dispose: () => {
            disposed = true;
        },
        onWheel,
    };
};
