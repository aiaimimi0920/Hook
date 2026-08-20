import type { StickerAnnotationState, StickerTextAnnotation } from "../types/stickerEditing";
import { translateAnnotation } from "./stickerGeometry";

export const removeAnnotationsByIds = (
    state: StickerAnnotationState,
    annotationIds: readonly string[],
): StickerAnnotationState => {
    const selectedIds = new Set(annotationIds);
    const elements = state.elements.filter((annotation) => !selectedIds.has(annotation.id));
    if (elements.length === state.elements.length) return state;
    return {
        ...state,
        elements,
    };
};

export const removeAnnotationById = (
    state: StickerAnnotationState,
    annotationId: string,
): StickerAnnotationState => removeAnnotationsByIds(state, [annotationId]);

export const updateTextAnnotationById = (
    state: StickerAnnotationState,
    annotationId: string,
    text: string,
): StickerAnnotationState => {
    const trimmed = text.trim();
    if (!trimmed) return state;

    let changed = false;
    const elements = state.elements.map((annotation) => {
        if (annotation.id !== annotationId) return annotation;
        if (annotation.type !== "text" && annotation.type !== "serial") return annotation;
        changed = true;
        const updated: StickerTextAnnotation = {
            ...annotation,
            text: trimmed,
        };
        return updated;
    });

    return changed ? { ...state, elements } : state;
};

export const updateTextAnnotationFontFamilyById = (
    state: StickerAnnotationState,
    annotationId: string,
    fontFamily: string,
): StickerAnnotationState => {
    const trimmed = fontFamily.trim();
    if (!trimmed) return state;

    let changed = false;
    const elements = state.elements.map((annotation) => {
        if (annotation.id !== annotationId) return annotation;
        if (annotation.type !== "text" && annotation.type !== "serial") return annotation;
        changed = true;
        const updated: StickerTextAnnotation = {
            ...annotation,
            fontFamily: trimmed,
        };
        return updated;
    });

    return changed ? { ...state, elements } : state;
};

export const duplicateAnnotationById = (
    state: StickerAnnotationState,
    annotationId: string,
    deltaX = 12,
    deltaY = 12,
): { elements: StickerAnnotationState["elements"]; createdAnnotationId?: string } => {
    const source = state.elements.find((annotation) => annotation.id === annotationId);
    if (!source) {
        return { elements: state.elements };
    }

    const duplicated = {
        ...translateAnnotation(source, deltaX, deltaY),
        id: crypto.randomUUID(),
        zIndex: state.elements.length + 1,
    };

    return {
        elements: [...state.elements, duplicated],
        createdAnnotationId: duplicated.id,
    };
};
