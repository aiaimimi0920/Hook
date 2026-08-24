import type { Accessor, Setter } from "solid-js";

import { graphStore } from "../store/graphStore";
import { stickerToolSettings, uiActions } from "../store/uiStore";
import type {
    StickerAnnotationState,
    StickerEffectAnnotation,
    StickerImageEditState,
    StickerLineAnnotation,
    StickerShapeAnnotation,
} from "../types/stickerEditing";
import type { Unit } from "../types/unit";
import {
    clampCropRectToStickerBounds,
    clampShapeRectToStickerBounds,
    computeNextCropFrame,
    constrainLinearToolEndpoint,
    createContentEraserStroke,
    HIGHLIGHTER_LAYER_OPACITY,
} from "../services/stickerEditing";
import {
    isBoundedBoxMode,
    isRegularShapeMode,
    isStraightLineMode,
    type DraftLine,
    type DraftShape,
} from "./stickerAnnotationModel";
import type { createStickerAnnotationEraseController } from "./stickerAnnotationEraseController";
import type { createStickerAnnotationPersistence } from "./stickerAnnotationPersistenceController";
import type { createStickerAnnotationPointerRuntime } from "./stickerAnnotationPointerRuntime";
import {
    buildReshapedPreviewAnnotations,
    buildResizedPreviewAnnotations,
    buildTransformPreviewAnnotations,
    type ActiveTransformInteraction,
    type ReshapeLineState,
    type ResizeAnnotationState,
} from "./stickerAnnotationTransformController";
import {
    getLineStrokeColor,
    getShapeFillColorForMode,
    getShapeStrokeColorForMode,
    isHighlighterLineMode,
} from "./stickerAnnotationStyle";
import {
    sanitizeContentEraserSize,
    sanitizeEffectBrushSize,
    sanitizeEffectStrength,
    sanitizePolygonSides,
    sanitizeShapeCornerRadius,
    sanitizeStickerPoints,
    sanitizeStickerRect,
    sanitizeStrokeWidth,
} from "./stickerAnnotationNumericSafety";

interface DraftRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface StickerAnnotationPointerCommitOptions {
    width: Accessor<number>;
    height: Accessor<number>;
    unitId: Accessor<string>;
    unit: Accessor<Unit | undefined>;
    annotationState: Accessor<StickerAnnotationState>;
    imageEditState: Accessor<StickerImageEditState>;
    draftShape: Accessor<DraftShape | null>;
    setDraftShape: Setter<DraftShape | null>;
    draftLine: Accessor<DraftLine | null>;
    setDraftLine: Setter<DraftLine | null>;
    resizeAnnotation: Accessor<ResizeAnnotationState | null>;
    setResizeAnnotation: Setter<ResizeAnnotationState | null>;
    reshapeLine: Accessor<ReshapeLineState | null>;
    setReshapeLine: Setter<ReshapeLineState | null>;
    transformInteraction: Accessor<ActiveTransformInteraction | null>;
    setTransformInteraction: Setter<ActiveTransformInteraction | null>;
    ctrlPressed: Accessor<boolean>;
    shiftPressed: Accessor<boolean>;
    resolveDraftShapeRect: (draft: DraftShape) => DraftRect;
    isSquareConstraintActive: (event?: PointerEvent) => boolean;
    isRegularShapeStepSnapActive: (mode: DraftShape["mode"], event?: PointerEvent) => boolean;
    pointerRuntime: ReturnType<typeof createStickerAnnotationPointerRuntime>;
    persistence: Pick<
        ReturnType<typeof createStickerAnnotationPersistence>,
        "commitAnnotation" | "commitAnnotationElements" | "patchUnitData" | "rememberCurrentState"
    >;
    erase: Pick<
        ReturnType<typeof createStickerAnnotationEraseController>,
        | "appendLiveErasePoint"
        | "commitContentErase"
        | "finishActiveLiveErase"
        | "liveErasePreviewVisible"
        | "liveEraseStrokePoints"
        | "resetLiveEraseRuntime"
    >;
}

// Own pointer-move mutation and the single release-time commit. The move path
// deliberately keeps DOM transforms imperative and writes graph state only once.
export const createStickerAnnotationPointerCommitController = (
    options: StickerAnnotationPointerCommitOptions,
) => {
    const {
        applyImperativeMovePreview,
        clearImperativeMovePreview,
        getImperativeMovePoint,
        releaseHostPointer,
        toLocalPoint,
    } = options.pointerRuntime;
    const {
        commitAnnotation,
        commitAnnotationElements,
        patchUnitData,
        rememberCurrentState,
    } = options.persistence;
    const {
        appendLiveErasePoint,
        commitContentErase,
        finishActiveLiveErase,
        liveErasePreviewVisible,
        liveEraseStrokePoints,
        resetLiveEraseRuntime,
    } = options.erase;
    let pointerReleaseInFlight = false;

    const isStraightLineAngleLockActive = (mode: DraftLine["mode"], event?: PointerEvent) =>
        isStraightLineMode(mode) && (!!event?.shiftKey || options.shiftPressed());
    const isStraightLineStepSnapActive = (mode: DraftLine["mode"], event?: PointerEvent) =>
        (mode === "line" || mode === "arrow") && (!!event?.ctrlKey || options.ctrlPressed());

    const onPointerMove = (event: PointerEvent) => {
        const transform = options.transformInteraction();
        if (transform) {
            const point = toLocalPoint(event);
            if (transform.kind === "move") {
                applyImperativeMovePreview(transform, point);
                return;
            }
            options.setTransformInteraction((prev) =>
                prev ? { ...prev, currentPoint: point } : prev,
            );
            return;
        }

        if (options.reshapeLine()) {
            const point = toLocalPoint(event);
            options.setReshapeLine((prev) => (prev ? { ...prev, current: point } : prev));
            return;
        }

        if (options.resizeAnnotation()) {
            const point = toLocalPoint(event);
            options.setResizeAnnotation((prev) => (prev ? { ...prev, current: point } : prev));
            return;
        }

        if (options.draftShape()) {
            options.setDraftShape((prev) => {
                if (!prev) return prev;
                const nextPoint = toLocalPoint(event);
                if (isBoundedBoxMode(prev.mode)) {
                    const constrainSquare =
                        isRegularShapeMode(prev.mode) &&
                        (stickerToolSettings.shapeConstrainSquare || options.isSquareConstraintActive(event));
                    const effectiveSnapStep = stickerToolSettings.shapeSnapStep > 0
                        ? stickerToolSettings.shapeSnapStep
                        : options.isRegularShapeStepSnapActive(prev.mode, event) ? 10 : undefined;
                    const bounds = { w: options.width(), h: options.height() };
                    const clampedRect = constrainSquare
                        ? clampShapeRectToStickerBounds(prev.start, nextPoint, bounds, true, effectiveSnapStep)
                        : isRegularShapeMode(prev.mode)
                          ? clampShapeRectToStickerBounds(prev.start, nextPoint, bounds, false, effectiveSnapStep)
                          : clampCropRectToStickerBounds(prev.start, nextPoint, bounds);
                    return {
                        ...prev,
                        constrainSquare,
                        snapStep: effectiveSnapStep,
                        current: {
                            x: prev.start.x <= nextPoint.x
                                ? clampedRect.x + clampedRect.w
                                : clampedRect.x,
                            y: prev.start.y <= nextPoint.y
                                ? clampedRect.y + clampedRect.h
                                : clampedRect.y,
                        },
                    };
                }
                return { ...prev, current: nextPoint };
            });
            return;
        }

        if (options.draftLine()) {
            const currentDraft = options.draftLine();
            const point = toLocalPoint(event);
            const shouldRenderDraftAsStraightSegment = (mode: DraftLine["mode"]) =>
                mode === "line" || mode === "arrow" || isStraightLineAngleLockActive(mode, event);
            const lineAngleSnapToggleActive = (mode: DraftLine["mode"]) =>
                (mode === "line" || mode === "arrow") && stickerToolSettings.lineAngleSnap;
            if (currentDraft?.mode === "content-eraser") {
                const lastPoint = appendLiveErasePoint(point);
                if (!liveErasePreviewVisible()) {
                    options.setDraftLine((previous) =>
                        previous ? { ...previous, points: [lastPoint, point] } : previous,
                    );
                }
                return;
            }
            options.setDraftLine((prev) =>
                prev
                    ? shouldRenderDraftAsStraightSegment(prev.mode)
                        ? {
                              ...prev,
                              points: [
                                  prev.points[0],
                                  constrainLinearToolEndpoint(prev.points[0], point, {
                                      lockAngle:
                                          isStraightLineAngleLockActive(prev.mode, event) ||
                                          lineAngleSnapToggleActive(prev.mode),
                                      angleStepDegrees: isStraightLineAngleLockActive(prev.mode, event)
                                          ? 45
                                          : 5,
                                      snapStep: isStraightLineStepSnapActive(prev.mode, event) ? 10 : undefined,
                                  }),
                              ],
                          }
                        : {
                              ...prev,
                              points: [
                                  ...prev.points,
                                  isStraightLineStepSnapActive(prev.mode, event)
                                      ? constrainLinearToolEndpoint(prev.points[0], point, { snapStep: 10 })
                                      : point,
                              ],
                          }
                    : prev,
            );
        }
    };

    const commitPointerRelease = async () => {
        releaseHostPointer();
        const transform = options.transformInteraction();
        const reshape = options.reshapeLine();
        const resize = options.resizeAnnotation();
        const shape = options.draftShape();
        const line = options.draftLine();
        const contentEraserPoints =
            line?.mode === "content-eraser" && liveEraseStrokePoints().length > 0
                ? [...liveEraseStrokePoints()]
                : line?.points ?? [];
        options.setReshapeLine(null);
        options.setResizeAnnotation(null);
        options.setDraftShape(null);
        options.setDraftLine(null);

        if (transform) {
            const imperativeMovePoint = getImperativeMovePoint();
            const committedTransform =
                transform.kind === "move" && imperativeMovePoint
                    ? { ...transform, currentPoint: imperativeMovePoint }
                    : transform;
            try {
                const commit = commitAnnotationElements(
                    buildTransformPreviewAnnotations(
                        committedTransform,
                        options.annotationState().elements,
                        options.shiftPressed(),
                    ),
                );
                // Store patching is synchronous; clear the transient transform only
                // after committed coordinates are live to prevent a visual flashback.
                clearImperativeMovePreview();
                await commit;
                uiActions.setSelectedStickerAnnotations(transform.annotationIds);
            } finally {
                clearImperativeMovePreview();
                options.setTransformInteraction(null);
            }
            return;
        }
        clearImperativeMovePreview();
        options.setTransformInteraction(null);

        if (reshape) {
            await commitAnnotationElements(
                buildReshapedPreviewAnnotations(reshape, options.annotationState().elements),
            );
            uiActions.setSelectedStickerAnnotation(reshape.annotationId);
            return;
        }

        if (resize) {
            await commitAnnotationElements(
                buildResizedPreviewAnnotations(resize, options.annotationState().elements),
            );
            uiActions.setSelectedStickerAnnotation(resize.annotationId);
            return;
        }

        if (shape) {
            const rect = sanitizeStickerRect(options.resolveDraftShapeRect(shape));
            if (!rect || rect.w < 4 || rect.h < 4) return;
            if (shape.mode === "crop") {
                const unit = options.unit();
                if (!unit) return;
                rememberCurrentState();
                const nextCrop = computeNextCropFrame(
                    { x: unit.x, y: unit.y, w: unit.w, h: unit.h },
                    options.imageEditState(),
                    rect,
                );
                graphStore.actions.updateUnit(options.unitId(), nextCrop.unitRect);
                await patchUnitData({
                    imageEditState: {
                        ...options.imageEditState(),
                        contentEraseStrokes: options.imageEditState().contentEraseStrokes,
                        cropRect: nextCrop.cropRect,
                        sourceSize: nextCrop.sourceSize,
                    },
                }, { propagateEdit: true });
                return;
            }
            const rawCornerRadius =
                shape.mode === "shape-round-rect" && stickerToolSettings.shapeCornerRadius === 0
                    ? 12
                    : stickerToolSettings.shapeCornerRadius;
            const cornerRadius = sanitizeShapeCornerRadius(rawCornerRadius);
            const type: StickerShapeAnnotation["type"] =
                shape.mode === "shape-ellipse"
                    ? "ellipse"
                    : shape.mode === "shape-triangle"
                      ? "triangle"
                      : shape.mode === "shape-polygon"
                        ? "polygon"
                        : cornerRadius > 0
                          ? "round-rect"
                          : "rect";
            await commitAnnotation({
                id: crypto.randomUUID(),
                type,
                zIndex: options.annotationState().elements.length + 1,
                ...rect,
                sides: type === "polygon" ? sanitizePolygonSides(stickerToolSettings.polygonSides) : undefined,
                style: {
                    color: getShapeStrokeColorForMode(shape.mode),
                    width: sanitizeStrokeWidth(stickerToolSettings.strokeWidth),
                    opacity: 1,
                    fill: getShapeFillColorForMode(shape.mode),
                    cornerRadius,
                    dashPattern: stickerToolSettings.shapeStrokeDashPattern,
                },
            });
            return;
        }

        if (!line) return;
        const allowsSinglePoint =
            line.mode === "content-eraser" || line.mode === "mosaic" || line.mode === "blur";
        const committedPoints = sanitizeStickerPoints(
            line.mode === "content-eraser" ? contentEraserPoints : line.points,
        );
        if (committedPoints.length < (allowsSinglePoint ? 1 : 2)) return;
        if (line.mode === "content-eraser") {
            const activeErase = await finishActiveLiveErase();
            if (activeErase) {
                if (activeErase.finished) return;
                if (activeErase.mode === "annotations") return;
            }
            const stroke = {
                ...createContentEraserStroke(
                    crypto.randomUUID(),
                    "#000000",
                    sanitizeContentEraserSize(stickerToolSettings.contentEraserSize),
                    1,
                ),
                points: committedPoints,
            };
            try {
                await commitContentErase(stroke);
            } finally {
                resetLiveEraseRuntime();
            }
            return;
        }

        if (line.mode === "mosaic" || line.mode === "blur") {
            const brushWidth = sanitizeEffectBrushSize(stickerToolSettings.effectBrushSize);
            const pad = brushWidth / 2;
            let rawMinX = Infinity;
            let rawMinY = Infinity;
            let rawMaxX = -Infinity;
            let rawMaxY = -Infinity;
            for (const point of committedPoints) {
                if (point.x < rawMinX) rawMinX = point.x;
                if (point.y < rawMinY) rawMinY = point.y;
                if (point.x > rawMaxX) rawMaxX = point.x;
                if (point.y > rawMaxY) rawMaxY = point.y;
            }
            const minX = rawMinX - pad;
            const minY = rawMinY - pad;
            const maxX = rawMaxX + pad;
            const maxY = rawMaxY + pad;
            const effectStyle = line.mode === "mosaic"
                ? {
                      color: stickerToolSettings.effectBorderColor,
                      width: 0,
                      opacity: 1,
                      fill: stickerToolSettings.mosaicColorA,
                      secondaryFill: stickerToolSettings.mosaicColorB,
                  }
                : {
                      color: stickerToolSettings.effectBorderColor,
                      width: 0,
                      opacity: 1,
                  };
            const effectAnnotation: StickerEffectAnnotation = {
                id: crypto.randomUUID(),
                type: line.mode === "mosaic" ? "mosaic" : "blur",
                zIndex: options.annotationState().elements.length + 1,
                x: minX,
                y: minY,
                w: Math.max(1, maxX - minX),
                h: Math.max(1, maxY - minY),
                points: committedPoints,
                brushWidth,
                style: effectStyle,
                strength:
                    line.mode === "mosaic"
                        ? sanitizeEffectStrength(stickerToolSettings.mosaicSize, 12)
                        : sanitizeEffectStrength(stickerToolSettings.blurStrength, 8),
            };
            await commitAnnotation(effectAnnotation);
            return;
        }

        const type: StickerLineAnnotation["type"] =
            isHighlighterLineMode(line.mode)
                ? "highlighter"
                : line.mode === "arrow" || (line.mode === "line" && line.showArrowHead)
                  ? "arrow"
                  : line.mode === "line"
                    ? "line"
                    : line.mode === "polyline"
                      ? "polyline"
                      : "brush";
        const supportsDashPattern = type === "line" || type === "arrow" || type === "brush";
        await commitAnnotation({
            id: crypto.randomUUID(),
            type,
            zIndex: options.annotationState().elements.length + 1,
            points: committedPoints,
            style: {
                color: getLineStrokeColor(line.mode),
                width: sanitizeStrokeWidth(
                    stickerToolSettings.strokeWidth,
                    type === "brush" || type === "highlighter" ? 1 : 0,
                ),
                opacity: isHighlighterLineMode(line.mode) ? HIGHLIGHTER_LAYER_OPACITY : 1,
                dashPattern: supportsDashPattern ? stickerToolSettings.shapeStrokeDashPattern : undefined,
            },
        });
    };

    // Pointerup and pointercancel may both arrive for one native gesture. Keep
    // the async persistence path single-flight so a draft cannot commit twice.
    const onPointerUp = async () => {
        if (pointerReleaseInFlight) return;
        pointerReleaseInFlight = true;
        try {
            await commitPointerRelease();
        } finally {
            pointerReleaseInFlight = false;
        }
    };

    return {
        isPointerReleaseInFlight: () => pointerReleaseInFlight,
        onPointerMove,
        onPointerUp,
    };
};
