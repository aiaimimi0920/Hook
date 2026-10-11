import type { Unit } from "../types/unit";
import { translateAnnotation } from "./stickerAnnotationEditGeometry";
import { computeNextCropFrame, computeRestoredCropFrame } from "./stickerEditingGeometry";

type Frame = Pick<Unit, "x" | "y" | "w" | "h">;

// Editable marks live in the visible frame, not the retained image source frame.
// Keep off-crop geometry intact (including negative points) so reset/undo can
// reveal it again; the sticker viewport, not destructive clipping, hides it.
const translateFrameEdits = (data: Unit["data"], dx: number, dy: number): Partial<Unit["data"]> => ({
    annotationState: data.annotationState ? {
        ...data.annotationState,
        elements: data.annotationState.elements.map((annotation) => translateAnnotation(annotation, dx, dy)),
    } : undefined,
    imageEditState: {
        ...(data.imageEditState || { contentEraseStrokes: [] }),
        contentEraseStrokes: (data.imageEditState?.contentEraseStrokes || []).map((stroke) => ({
            ...stroke,
            points: stroke.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
        })),
    },
});

export const buildStickerCropEdit = (unit: Unit, selection: Frame) => {
    const next = computeNextCropFrame(unit, unit.data.imageEditState, selection);
    const data = translateFrameEdits(unit.data, -selection.x, -selection.y);
    data.imageEditState = { ...data.imageEditState!, cropRect: next.cropRect, sourceSize: next.sourceSize };
    return { frame: next.unitRect, data };
};

export const buildStickerCropReset = (unit: Unit) => {
    const frame = computeRestoredCropFrame(unit, unit.data.imageEditState);
    const data = translateFrameEdits(unit.data, unit.x - frame.x, unit.y - frame.y);
    // After reset the visible frame becomes the next crop's source coordinate
    // space; retaining a pre-resize sourceSize would shrink the next crop.
    data.imageEditState = { ...data.imageEditState!, cropRect: undefined, sourceSize: undefined };
    return { frame, data };
};
