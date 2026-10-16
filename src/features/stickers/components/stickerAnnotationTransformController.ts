import type { StickerAnnotation, StickerPoint } from "../types/stickerEditing";
import {
    moveLineEndpoint,
    resizeBoxAnnotation,
    rotateAnnotationsAroundGroupCenter,
    rotateAnnotationsAroundOwnCenters,
    scaleAnnotationsAroundGroupCenter,
    scaleAnnotationsAroundOwnCenters,
    translateAnnotation,
    type LineEndpointHandle,
    type ResizeHandle,
} from "../services/stickerGeometry";
import type { TransformAxisMode } from "./stickerAnnotationModel";

export type TransformInteractionKind = "move" | "rotate" | "scale";
export type TransformPivotMode = "group" | "own";
export type MoveAxisMode = TransformAxisMode;

export interface ActiveTransformInteraction {
    kind: TransformInteractionKind;
    annotationIds: string[];
    startPoint: StickerPoint;
    currentPoint: StickerPoint;
    baseAnnotations: StickerAnnotation[];
    pivotMode: TransformPivotMode;
    axis: MoveAxisMode;
    pivot: StickerPoint;
}

export interface ResizeAnnotationState {
    annotationId: string;
    handle: ResizeHandle;
    current: StickerPoint;
    original: StickerAnnotation;
}

export interface ReshapeLineState {
    annotationId: string;
    handle: LineEndpointHandle;
    current: StickerPoint;
    original: StickerAnnotation;
}

export const applyAnnotationReplacements = (
    elements: StickerAnnotation[],
    replacements: ReadonlyMap<string, StickerAnnotation>,
) => elements.map((annotation) => replacements.get(annotation.id) ?? annotation);

// Preview composition is pure: the component owns reactive state while this
// module owns the geometry policy used by move, rotate, scale and handle drags.
export const buildTransformPreviewAnnotations = (
    interaction: ActiveTransformInteraction,
    elements: StickerAnnotation[],
    keepUniform: boolean,
): StickerAnnotation[] => {
    const deltaX = interaction.currentPoint.x - interaction.startPoint.x;
    const deltaY = interaction.currentPoint.y - interaction.startPoint.y;
    if (interaction.kind === "move") {
        const appliedDeltaX = interaction.axis === "y" ? 0 : deltaX;
        const appliedDeltaY = interaction.axis === "x" ? 0 : deltaY;
        const replacements = new Map(
            interaction.baseAnnotations.map((annotation) => [
                annotation.id,
                translateAnnotation(annotation, appliedDeltaX, appliedDeltaY),
            ]),
        );
        return applyAnnotationReplacements(elements, replacements);
    }

    if (interaction.kind === "rotate") {
        const startAngle = Math.atan2(
            interaction.startPoint.y - interaction.pivot.y,
            interaction.startPoint.x - interaction.pivot.x,
        );
        const currentAngle = Math.atan2(
            interaction.currentPoint.y - interaction.pivot.y,
            interaction.currentPoint.x - interaction.pivot.x,
        );
        const radialAngleDegrees = ((currentAngle - startAngle) * 180) / Math.PI;
        const angleDegrees = interaction.axis === "xy"
            ? radialAngleDegrees
            : (interaction.axis === "x" ? deltaX : deltaY) * 0.5;
        const transformed = interaction.pivotMode === "own"
            ? rotateAnnotationsAroundOwnCenters(interaction.baseAnnotations, angleDegrees)
            : rotateAnnotationsAroundGroupCenter(interaction.baseAnnotations, angleDegrees);
        const replacements = new Map(transformed.map((annotation) => [annotation.id, annotation]));
        return applyAnnotationReplacements(elements, replacements);
    }

    const currentVector = {
        x: interaction.currentPoint.x - interaction.pivot.x,
        y: interaction.currentPoint.y - interaction.pivot.y,
    };
    const startVector = {
        x: interaction.startPoint.x - interaction.pivot.x,
        y: interaction.startPoint.y - interaction.pivot.y,
    };
    const safeRatio = (currentValue: number, startValue: number) => {
        if (Math.abs(startValue) < 0.0001) return 1;
        return Math.max(0.1, Math.min(8, currentValue / startValue));
    };
    const uniformScale = (() => {
        const currentDistance = Math.hypot(currentVector.x, currentVector.y);
        const startDistance = Math.hypot(startVector.x, startVector.y);
        if (startDistance < 0.0001) return 1;
        return Math.max(0.1, Math.min(8, currentDistance / startDistance));
    })();
    const scale = keepUniform
        ? { x: uniformScale, y: uniformScale }
        : {
              x: interaction.axis === "y" ? 1 : safeRatio(currentVector.x, startVector.x),
              y: interaction.axis === "x" ? 1 : safeRatio(currentVector.y, startVector.y),
          };
    const transformed = interaction.pivotMode === "own"
        ? scaleAnnotationsAroundOwnCenters(interaction.baseAnnotations, scale)
        : scaleAnnotationsAroundGroupCenter(interaction.baseAnnotations, scale);
    const replacements = new Map(transformed.map((annotation) => [annotation.id, annotation]));
    return applyAnnotationReplacements(elements, replacements);
};

export const buildReshapedPreviewAnnotations = (
    reshape: ReshapeLineState,
    elements: StickerAnnotation[],
) => applyAnnotationReplacements(
    elements,
    new Map([
        [reshape.annotationId, moveLineEndpoint(reshape.original, reshape.handle, reshape.current)],
    ]),
);

export const buildResizedPreviewAnnotations = (
    resize: ResizeAnnotationState,
    elements: StickerAnnotation[],
) => applyAnnotationReplacements(
    elements,
    new Map([
        [resize.annotationId, resizeBoxAnnotation(resize.original, resize.handle, resize.current)],
    ]),
);
