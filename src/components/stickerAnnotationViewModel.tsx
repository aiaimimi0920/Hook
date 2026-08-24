import { Show, createMemo, type Accessor, type JSX } from "solid-js";

import { buildSerialAnnotationMetrics } from "../services/stickerEditing";
import {
    getAnnotationGroupBounds,
    getAnnotationGroupCenter,
} from "../services/stickerGeometry";
import {
    selectedStickerAnnotationId,
    selectedStickerAnnotationIds,
    stickerToolSettings,
} from "../store/uiStore";
import type {
    StickerAnnotationState,
    StickerLineAnnotation,
    StickerTextAnnotation,
    StickerTransformMode,
} from "../types/stickerEditing";
import {
    annotationRenderRank,
    getScaleGizmoHandleRects,
    getVisibleFill,
    getVisibleStroke,
    type PendingTextInput,
} from "./stickerAnnotationModel";
import { buildAnnotationRotationTransform } from "./stickerAnnotationRenderGeometry";
import {
    buildReshapedPreviewAnnotations,
    buildResizedPreviewAnnotations,
    buildTransformPreviewAnnotations,
    type ActiveTransformInteraction,
    type ReshapeLineState,
    type ResizeAnnotationState,
} from "./stickerAnnotationTransformController";
import {
    sanitizeSerialRadius,
    sanitizeStrokeWidth,
    sanitizeTextSize,
} from "./stickerAnnotationNumericSafety";

interface StickerAnnotationViewModelOptions {
    width: Accessor<number>;
    height: Accessor<number>;
    annotationState: Accessor<StickerAnnotationState>;
    pendingTextInput: Accessor<PendingTextInput | null>;
    getPendingTextExistingAnnotation: (draft: PendingTextInput) => StickerTextAnnotation | undefined;
    transformInteraction: Accessor<ActiveTransformInteraction | null>;
    reshapeLine: Accessor<ReshapeLineState | null>;
    resizeAnnotation: Accessor<ResizeAnnotationState | null>;
    shiftPressed: Accessor<boolean>;
    ctrlPressed: Accessor<boolean>;
    altPressed: Accessor<boolean>;
    usesExistingNodeInteractions: Accessor<boolean>;
    effectiveTransformMode: Accessor<StickerTransformMode>;
    gizmo: {
        axisLength: number;
        centerSize: number;
        scaleHandleSize: number;
    };
}

// Build the read-only annotation presentation model. Pointer controllers own
// mutation; this module owns selection-derived previews and SVG text rendering.
export const createStickerAnnotationViewModel = (
    options: StickerAnnotationViewModelOptions,
) => {
    const selectedAnnotationIds = createMemo(() => {
        if (selectedStickerAnnotationIds.length > 0) {
            return [...selectedStickerAnnotationIds];
        }
        return selectedStickerAnnotationId() ? [selectedStickerAnnotationId()!] : [];
    });
    const selectedAnnotations = createMemo(() => {
        const idSet = new Set(selectedAnnotationIds());
        return options.annotationState().elements.filter((annotation) => idSet.has(annotation.id));
    });
    const selectedAnnotationCenter = createMemo(() =>
        selectedAnnotations().length > 0
            ? getAnnotationGroupCenter(selectedAnnotations())
            : { x: options.width() / 2, y: options.height() / 2 },
    );
    const showMoveAxesGizmo = createMemo(() => {
        if (!options.usesExistingNodeInteractions()) return false;
        const transformMode = options.effectiveTransformMode();
        return (
            selectedAnnotations().length > 0 &&
            (transformMode === "move" || (transformMode === "select" && options.altPressed()))
        );
    });
    const showScaleGizmo = createMemo(
        () =>
            options.usesExistingNodeInteractions() &&
            selectedAnnotations().length > 0 &&
            options.effectiveTransformMode() === "scale",
    );
    const showRotateGizmo = createMemo(() => {
        if (!options.usesExistingNodeInteractions()) return false;
        const transformMode = options.effectiveTransformMode();
        return (
            selectedAnnotations().length > 0 &&
            (transformMode === "rotate" ||
                (transformMode === "select" && options.ctrlPressed()))
        );
    });
    const scaleGizmoHandles = createMemo(() =>
        getScaleGizmoHandleRects(selectedAnnotationCenter(), {
            axisLength: options.gizmo.axisLength,
            centerSize: options.gizmo.centerSize,
            handleSize: options.gizmo.scaleHandleSize,
        }),
    );

    const previewAnnotations = createMemo(() => {
        const transform = options.transformInteraction();
        if (transform) {
            return buildTransformPreviewAnnotations(
                transform,
                options.annotationState().elements,
                options.shiftPressed(),
            );
        }
        const reshape = options.reshapeLine();
        if (reshape) {
            return buildReshapedPreviewAnnotations(reshape, options.annotationState().elements);
        }
        const resize = options.resizeAnnotation();
        if (resize) {
            return buildResizedPreviewAnnotations(resize, options.annotationState().elements);
        }
        return options.annotationState().elements;
    });
    const visiblePreviewAnnotations = createMemo(() => {
        const draft = options.pendingTextInput();
        const annotations = previewAnnotations();
        if (!draft?.annotationId) return annotations;
        return annotations.filter((annotation) => annotation.id !== draft.annotationId);
    });
    // Render highlighters once as a translucent group to avoid overlap darkening.
    const highlighterPreviewAnnotations = createMemo(() =>
        visiblePreviewAnnotations().filter(
            (annotation): annotation is StickerLineAnnotation => annotation.type === "highlighter",
        ),
    );
    const nonHighlighterPreviewAnnotations = createMemo(() =>
        visiblePreviewAnnotations()
            .filter((annotation) => annotation.type !== "highlighter")
            .map((annotation, index) => ({ annotation, index }))
            .sort(
                (a, b) =>
                    annotationRenderRank(a.annotation.type) -
                        annotationRenderRank(b.annotation.type) ||
                    a.index - b.index,
            )
            .map((entry) => entry.annotation),
    );
    const pendingTextPreviewAnnotation = createMemo<StickerTextAnnotation | null>(() => {
        const draft = options.pendingTextInput();
        if (!draft?.value) return null;
        const existing = options.getPendingTextExistingAnnotation(draft);
        return {
            id: draft.annotationId ?? "__pending_text_preview__",
            type: existing?.type ?? "text",
            zIndex: existing?.zIndex ?? options.annotationState().elements.length + 1,
            x: draft.x,
            y: draft.y,
            text: draft.value,
            fontSize: sanitizeTextSize(draft.fontSize),
            fontFamily: draft.fontFamily,
            style: {
                color: draft.color,
                width: sanitizeStrokeWidth(
                    existing?.style.width ?? stickerToolSettings.strokeWidth,
                ),
                opacity: existing?.style.opacity ?? 1,
                fill: existing?.style.fill,
                secondaryFill: existing?.style.secondaryFill,
                cornerRadius: existing?.style.cornerRadius,
            },
        };
    });
    const selectedPreviewAnnotations = createMemo(() => {
        const idSet = new Set(selectedAnnotationIds());
        return visiblePreviewAnnotations().filter((annotation) => idSet.has(annotation.id));
    });
    const selectedPreviewGroupBounds = createMemo(() =>
        selectedPreviewAnnotations().length > 1
            ? getAnnotationGroupBounds(selectedPreviewAnnotations())
            : undefined,
    );
    const selectedPreviewAnnotation = createMemo(() =>
        selectedStickerAnnotationId()
            ? selectedPreviewAnnotations().find(
                  (annotation) => annotation.id === selectedStickerAnnotationId(),
              )
            : undefined,
    );

    const renderTextAnnotation = (text: Accessor<StickerTextAnnotation>): JSX.Element => {
        const serialMetrics = createMemo(() =>
            buildSerialAnnotationMetrics(
                sanitizeSerialRadius(text().style.cornerRadius ?? 14),
            ),
        );
        const serialFontSize = createMemo(() =>
            sanitizeTextSize(text().fontSize ?? serialMetrics().fontSize),
        );
        const serialBorderWidth = createMemo(
            () => sanitizeStrokeWidth(text().style.width || serialMetrics().borderWidth),
        );
        const renderedFontSize = createMemo(() =>
            sanitizeTextSize(
                text().fontSize ??
                    (text().type === "serial"
                        ? serialMetrics().fontSize
                        : stickerToolSettings.textSize),
            ),
        );
        const rotationTransform = createMemo(() => buildAnnotationRotationTransform(text()));
        return (
            <g transform={rotationTransform()}>
                <Show when={text().type === "serial"}>
                    <circle
                        cx={text().x + serialMetrics().radius}
                        cy={text().y - serialFontSize() / 2}
                        r={serialMetrics().radius}
                        fill={getVisibleFill(text().style.fill)}
                        stroke={getVisibleStroke(text().style.color, serialBorderWidth())}
                        stroke-width={serialBorderWidth()}
                    />
                </Show>
                <text
                    x={text().x + (text().type === "serial" ? serialMetrics().radius : 0)}
                    y={text().type === "serial" ? text().y - serialFontSize() / 2 : text().y}
                    text-anchor={text().type === "serial" ? "middle" : "start"}
                    dominant-baseline={text().type === "serial" ? "central" : undefined}
                    fill={text().style.color}
                    font-size={String(renderedFontSize())}
                    font-family={
                        text().fontFamily ??
                        (text().type === "serial"
                            ? stickerToolSettings.serialFontFamily
                            : stickerToolSettings.textFontFamily)
                    }
                    font-weight={text().type === "serial" ? 700 : 500}
                >
                    {text().text}
                </text>
            </g>
        );
    };

    return {
        highlighterPreviewAnnotations,
        nonHighlighterPreviewAnnotations,
        pendingTextPreviewAnnotation,
        renderTextAnnotation,
        scaleGizmoHandles,
        selectedAnnotationCenter,
        selectedAnnotationIds,
        selectedPreviewAnnotation,
        selectedPreviewAnnotations,
        selectedPreviewGroupBounds,
        showMoveAxesGizmo,
        showRotateGizmo,
        showScaleGizmo,
    };
};
