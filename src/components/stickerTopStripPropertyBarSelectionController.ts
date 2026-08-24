import { createMemo, createSignal, type Accessor } from "solid-js";

import { graphStore } from "../store/graphStore";
import { updateTextAnnotationFontFamilyById } from "../services/stickerAnnotationMutations";
import { normalizeStickerPaletteColor } from "../services/stickerEditing";
import { syncStickerEditAfterLocalCommit } from "../services/stickerTopStripSync";
import {
    selectedStickerAnnotationId,
    selectedStickerAnnotationIds,
    stickerToolSettings,
} from "../store/uiStore";
import type { StickerTextAnnotation } from "../types/stickerEditing";
import type { Unit } from "../types/unit";
import type { SelectedExistingColorRole } from "./stickerTopStripPropertyBarSections";
import { parseCanvasStepperValue } from "./stickerTopStripPropertyBarNumeric";

interface CreatePropertyBarSelectionControllerOptions {
    unitId: Accessor<string>;
    unit: Accessor<Unit | undefined>;
    pushCurrentStickerHistory: () => boolean;
}

/** Owns second-pass text/serial selection state and annotation mutations. */
export const createPropertyBarSelectionController = (
    options: CreatePropertyBarSelectionControllerOptions,
) => {
    const [selectedTextSizeDraft, setSelectedTextSizeDraft] = createSignal<string | null>(null);
    const [selectedSerialRadiusDraft, setSelectedSerialRadiusDraft] = createSignal<string | null>(null);

    const selectedExistingTextAnnotation = createMemo(() => {
        const annotationId = selectedStickerAnnotationId();
        if (!annotationId || selectedStickerAnnotationIds.length !== 1) return undefined;
        const annotation = options.unit()?.data.annotationState?.elements.find((item) => item.id === annotationId);
        return annotation && (annotation.type === "text" || annotation.type === "serial") ? annotation : undefined;
    });
    const selectedExistingTextFontFamily = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        return annotation?.type === "text"
            ? annotation.fontFamily || stickerToolSettings.textFontFamily
            : stickerToolSettings.textFontFamily;
    });
    const selectedExistingTextSize = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        return annotation?.type === "text"
            ? annotation.fontSize ?? stickerToolSettings.textSize
            : stickerToolSettings.textSize;
    });
    const selectedExistingTextColor = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        return annotation?.type === "text" ? annotation.style.color : stickerToolSettings.textColor;
    });
    const selectedExistingSerialFontFamily = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        return annotation?.type === "serial"
            ? annotation.fontFamily || stickerToolSettings.serialFontFamily
            : stickerToolSettings.serialFontFamily;
    });
    const selectedExistingSerialRadius = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        return annotation?.type === "serial"
            ? Math.max(8, Math.round(annotation.style.cornerRadius ?? stickerToolSettings.serialRadius))
            : stickerToolSettings.serialRadius;
    });
    const selectedExistingSerialForegroundColor = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        return annotation?.type === "serial"
            ? annotation.style.color
            : stickerToolSettings.serialForegroundColor;
    });
    const selectedExistingSerialFillColor = createMemo(() => {
        const annotation = selectedExistingTextAnnotation();
        return annotation?.type === "serial"
            ? annotation.style.fill || stickerToolSettings.serialFillColor
            : stickerToolSettings.serialFillColor;
    });

    const applySelectedAnnotationFontFamilyChange = (
        annotationType: "text" | "serial",
        fontFamily: string,
    ) => {
        const trimmed = fontFamily.trim();
        if (!trimmed) return;

        const selectedAnnotation = selectedExistingTextAnnotation();
        const currentState = options.unit()?.data.annotationState;
        if (selectedAnnotation?.type !== annotationType || !currentState) return;
        if (!options.pushCurrentStickerHistory()) return;

        graphStore.actions.updateUnitData(options.unitId(), {
            annotationState: updateTextAnnotationFontFamilyById(currentState, selectedAnnotation.id, trimmed),
        });
        syncStickerEditAfterLocalCommit();
    };

    const updateSelectedTextAnnotationStyle = (
        updater: (annotation: StickerTextAnnotation) => StickerTextAnnotation,
    ) => {
        const selectedAnnotation = selectedExistingTextAnnotation();
        const currentState = options.unit()?.data.annotationState;
        if (!selectedAnnotation || !currentState) return;
        if (!options.pushCurrentStickerHistory()) return;

        graphStore.actions.updateUnitData(options.unitId(), {
            annotationState: {
                ...currentState,
                elements: currentState.elements.map((annotation) =>
                    annotation.id === selectedAnnotation.id &&
                    (annotation.type === "text" || annotation.type === "serial")
                        ? updater(annotation)
                        : annotation,
                ),
            },
        });
        syncStickerEditAfterLocalCommit();
    };

    const patchSelectedTextAnnotationFontSize = (next: number) => {
        const clamped = Math.min(96, Math.max(8, Math.round(next)));
        updateSelectedTextAnnotationStyle((annotation) =>
            annotation.type !== "text" ? annotation : { ...annotation, fontSize: clamped },
        );
    };

    const patchSelectedSerialAnnotationRadius = (next: number) => {
        const clamped = Math.min(96, Math.max(8, Math.round(next)));
        updateSelectedTextAnnotationStyle((annotation) =>
            annotation.type !== "serial"
                ? annotation
                : { ...annotation, style: { ...annotation.style, cornerRadius: clamped } },
        );
    };

    const patchSelectedExistingColor = (role: SelectedExistingColorRole, color: string) => {
        const normalized = normalizeStickerPaletteColor(color);
        if (!normalized) return;

        switch (role) {
            case "selected-text-color":
                updateSelectedTextAnnotationStyle((annotation) =>
                    annotation.type !== "text"
                        ? annotation
                        : { ...annotation, style: { ...annotation.style, color: normalized } },
                );
                return;
            case "selected-serial-foreground":
                updateSelectedTextAnnotationStyle((annotation) =>
                    annotation.type !== "serial"
                        ? annotation
                        : { ...annotation, style: { ...annotation.style, color: normalized } },
                );
                return;
            case "selected-serial-fill":
                updateSelectedTextAnnotationStyle((annotation) =>
                    annotation.type !== "serial"
                        ? annotation
                        : { ...annotation, style: { ...annotation.style, fill: normalized } },
                );
        }
    };

    const commitSelectedTextSizeDraft = () => {
        const fallback = selectedExistingTextSize();
        const nextSize = parseCanvasStepperValue(selectedTextSizeDraft(), fallback, 8, 96);
        setSelectedTextSizeDraft(null);
        if (nextSize !== fallback) patchSelectedTextAnnotationFontSize(nextSize);
    };

    const commitSelectedSerialRadiusDraft = () => {
        const fallback = selectedExistingSerialRadius();
        const nextRadius = parseCanvasStepperValue(selectedSerialRadiusDraft(), fallback, 8, 96);
        setSelectedSerialRadiusDraft(null);
        if (nextRadius !== fallback) patchSelectedSerialAnnotationRadius(nextRadius);
    };

    return {
        selectedTextSizeDraft,
        setSelectedTextSizeDraft,
        selectedSerialRadiusDraft,
        setSelectedSerialRadiusDraft,
        selectedExistingTextAnnotation,
        selectedExistingTextFontFamily,
        selectedExistingTextSize,
        selectedExistingTextColor,
        selectedExistingSerialFontFamily,
        selectedExistingSerialRadius,
        selectedExistingSerialForegroundColor,
        selectedExistingSerialFillColor,
        applySelectedAnnotationFontFamilyChange,
        patchSelectedExistingColor,
        commitSelectedTextSizeDraft,
        commitSelectedSerialRadiusDraft,
    };
};
