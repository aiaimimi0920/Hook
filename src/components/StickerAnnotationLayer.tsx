import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { Dynamic, Portal } from "solid-js/web";

import { api } from "../services/api";
import { graphStore } from "../store/graphStore";
import {
    activeStickerEditTargetId,
    selectedStickerId,
    selectedStickerAnnotationId,
    selectedStickerAnnotationIds,
    stickerEditCancelToken,
    stickerColorState,
    stickerToolSettings,
    uiActions,
} from "../store/uiStore";
import type {
    StickerCreateTool,
    ContentEraserStroke,
    StickerAnnotation,
    StickerEffectAnnotation,
    StickerLineAnnotation,
    StickerPoint,
    StickerShapeAnnotation,
    StickerTextAnnotation,
    StickerTransformMode,
} from "../types/stickerEditing";
import type { Unit } from "../types/unit";
import {
    clampCropRectToStickerBounds,
    clampShapeRectToStickerBounds,
    constrainLinearToolEndpoint,
    buildSerialAnnotationMetrics,
    computeNextCropFrame,
    createContentEraserStroke,
    createEmptyAnnotationState,
    HIGHLIGHTER_LAYER_OPACITY,
    createEmptyImageEditState,
    getEffectiveStickerColor,
    nextSerialLabel,
} from "../services/stickerEditing";
import {
    captureStickerEditSnapshot,
} from "../services/stickerHistory";
import {
    applyContentEraseToBaseLayer,
    applyLiveContentEraseToStickerLayers,
    applyRasterizedContentErase,
    composeRasterizedStickerPreview,
    eraseRasterizedAnnotationLayer,
} from "../services/stickerBitmapLayers";
import { renderStickerBaseLayer } from "../services/stickerExport";
import { LiveEraseQueue } from "../services/liveEraseQueue";
import {
    buildLineMeasurementBadge,
    buildShapeMeasurementBadge,
    type MeasurementBadge,
} from "../services/stickerMeasurements";
import {
    buildArrowHeadPolygon,
    cloneStickerAnnotation,
    buildPolygonPoints,
    buildRoundedPolygonPath,
    buildTrianglePoints,
    findTopmostAnnotationAtPoint,
    getAnnotationBounds,
    getAnnotationCenter,
    getAnnotationGroupBounds,
    getAnnotationGroupCenter,
    getArrowShaftPoints,
    moveLineEndpoint,
    resizeBoxAnnotation,
    rotateAnnotationsAroundGroupCenter,
    rotateAnnotationsAroundOwnCenters,
    scaleAnnotationsAroundGroupCenter,
    scaleAnnotationsAroundOwnCenters,
    type LineEndpointHandle,
    type ResizeHandle,
    translateAnnotation,
} from "../services/stickerGeometry";
import { updateTextAnnotationById } from "../services/stickerAnnotationMutations";
import { syncService } from "../services/syncService";
import { renderStickerEffectOverlay, StickerEffectDraftOverlay, buildStrokePath } from "./StickerEffectOverlay";
import {
    annotationRenderRank,
    getScaleGizmoHandleRects,
    getAnnotationCornerRadius,
    getStrokeDashArray,
    getVisibleFill,
    getVisibleStroke,
    isBoundedBoxMode,
    isMeasuredLineMode,
    isRegularShapeMode,
    isStraightLineMode,
    normalizeRect,
    resolveMoveGizmoAxisAtPoint,
    resolveScaleGizmoAxisAtPoint,
    type ColorPickerPreview,
    type DraftLine,
    type DraftShape,
    type GlobalColorPickerMousePayload,
    type PendingTextInput,
    type TransformAxisMode,
} from "./stickerAnnotationModel";
import { getShapeStrokeColorKey, getShapeFillColorKey } from "./stickerToolbarModel";

interface StickerAnnotationLayerProps {
    unitId: string;
    width: number;
    height: number;
    imageSrc?: string;
}

const TRANSFORM_GIZMO_AXIS_LENGTH = 44;
const TRANSFORM_GIZMO_RING_RADIUS = 28;
const TRANSFORM_GIZMO_HIT_PADDING = 8;
const TRANSFORM_GIZMO_CENTER_SIZE = 10;
const TRANSFORM_GIZMO_SCALE_HANDLE_SIZE = 12;

// Mirror the commit-time corner-radius substitution so the round-rect drag
// preview matches the committed shape: a round-rect with radius 0 commits at 12.
const getShapeCornerRadius = (mode?: DraftShape["mode"]) =>
    mode === "shape-round-rect" && stickerToolSettings.shapeCornerRadius === 0
        ? 12
        : stickerToolSettings.shapeCornerRadius;

// Resolve the per-tool stroke/fill colors so each shape keeps its own color.
const getShapeStrokeColorForMode = (mode: DraftShape["mode"] | StickerCreateTool) =>
    stickerToolSettings[getShapeStrokeColorKey(mode)];
const getShapeFillColorForMode = (mode: DraftShape["mode"] | StickerCreateTool) => {
    const key = getShapeFillColorKey(mode);
    return key ? stickerToolSettings[key] : "transparent";
};

type TransformInteractionKind = "move" | "rotate" | "scale";
type TransformPivotMode = "group" | "own";
type MoveAxisMode = TransformAxisMode;

interface ActiveTransformInteraction {
    kind: TransformInteractionKind;
    annotationIds: string[];
    startPoint: StickerPoint;
    currentPoint: StickerPoint;
    baseAnnotations: StickerAnnotation[];
    pivotMode: TransformPivotMode;
    axis: MoveAxisMode;
    pivot: StickerPoint;
}

export const StickerAnnotationLayer: Component<StickerAnnotationLayerProps> = (props) => {
    let hostRef: HTMLDivElement | undefined;
    let pendingTextInputRef: HTMLInputElement | undefined;
    const [draftShape, setDraftShape] = createSignal<DraftShape | null>(null);
    const [draftLine, setDraftLine] = createSignal<DraftLine | null>(null);
    const [activePointerId, setActivePointerId] = createSignal<number | null>(null);
    const [colorPickerPreview, setColorPickerPreview] = createSignal<ColorPickerPreview | null>(null);
    const [pendingTextInput, setPendingTextInput] = createSignal<PendingTextInput | null>(null);
    const [ctrlPressed, setCtrlPressed] = createSignal(false);
    const [shiftPressed, setShiftPressed] = createSignal(false);
    const [dragAnnotation, setDragAnnotation] = createSignal<{
        annotationId: string;
        start: StickerPoint;
        current: StickerPoint;
    } | null>(null);
    const [resizeAnnotation, setResizeAnnotation] = createSignal<{
        annotationId: string;
        handle: ResizeHandle;
        current: StickerPoint;
        original: StickerAnnotation;
    } | null>(null);
    const [reshapeLine, setReshapeLine] = createSignal<{
        annotationId: string;
        handle: LineEndpointHandle;
        current: StickerPoint;
        original: StickerAnnotation;
    } | null>(null);
    const [altPressed, setAltPressed] = createSignal(false);
    const [transformInteraction, setTransformInteraction] = createSignal<ActiveTransformInteraction | null>(null);
    const logWheelEvent = (phase: string, detail: string) => {
        void api.debugLogEvent("sticker-wheel-trace", `layer=annotation phase=${phase} unit=${props.unitId} ${detail}`);
    };

    const unit = createMemo(() => graphStore.units.find((item) => item.id === props.unitId));
    const group = createMemo(() =>
        unit()?.data.groupId
            ? graphStore.stickerGroups.find((item) => item.id === unit()!.data.groupId)
            : undefined,
    );
    const annotationState = createMemo(
        () => unit()?.data.annotationState || createEmptyAnnotationState(),
    );
    const imageEditState = createMemo(
        () => unit()?.data.imageEditState || createEmptyImageEditState(),
    );

    const interactionEnabled = createMemo(
        () =>
            selectedStickerId() === props.unitId &&
            activeStickerEditTargetId() === props.unitId &&
            !unit()?.data.minified &&
            !group()?.locked,
    );
    const cropClipped = createMemo(
        () =>
            (stickerToolSettings.domain === "sticker" && stickerToolSettings.activeCanvasTool === "crop") ||
            (draftShape() ? isBoundedBoxMode(draftShape()!.mode) : false),
    );
    const selectedAnnotationIds = createMemo(() => {
        if (selectedStickerAnnotationIds.length > 0) {
            return [...selectedStickerAnnotationIds];
        }
        return selectedStickerAnnotationId() ? [selectedStickerAnnotationId()!] : [];
    });
    const selectedAnnotations = createMemo(() => {
        const idSet = new Set(selectedAnnotationIds());
        return annotationState().elements.filter((annotation) => idSet.has(annotation.id));
    });
    const isStickerSelectionFallback = createMemo(
        () => stickerToolSettings.domain === "sticker" && stickerToolSettings.activeCanvasTool === "idle",
    );
    const usesExistingNodeInteractions = createMemo(
        () => stickerToolSettings.domain === "existing" || isStickerSelectionFallback(),
    );
    const effectiveTransformMode = createMemo<StickerTransformMode>(() =>
        isStickerSelectionFallback() ? "select" : stickerToolSettings.transformMode,
    );
    const selectedAnnotationCenter = createMemo(() =>
        selectedAnnotations().length > 0 ? getAnnotationGroupCenter(selectedAnnotations()) : { x: props.width / 2, y: props.height / 2 },
    );
    const showMoveAxesGizmo = createMemo(() => {
        if (!usesExistingNodeInteractions()) return false;
        const transformMode = effectiveTransformMode();
        return (
            selectedAnnotations().length > 0 &&
            (
                transformMode === "move" ||
                (transformMode === "select" && altPressed())
            )
        );
    });
    const showScaleGizmo = createMemo(() => {
        if (!usesExistingNodeInteractions()) return false;
        return selectedAnnotations().length > 0 && effectiveTransformMode() === "scale";
    });
    const showRotateGizmo = createMemo(() => {
        if (!usesExistingNodeInteractions()) return false;
        const transformMode = effectiveTransformMode();
        return selectedAnnotations().length > 0 && (transformMode === "rotate" || (transformMode === "select" && ctrlPressed()));
    });
    const scaleGizmoHandles = createMemo(() =>
        getScaleGizmoHandleRects(selectedAnnotationCenter(), {
            axisLength: TRANSFORM_GIZMO_AXIS_LENGTH,
            centerSize: TRANSFORM_GIZMO_CENTER_SIZE,
            handleSize: TRANSFORM_GIZMO_SCALE_HANDLE_SIZE,
        }),
    );

    const buildTransformPreviewAnnotations = (
        interaction: ActiveTransformInteraction,
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
            return annotationState().elements.map((annotation) => replacements.get(annotation.id) ?? annotation);
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
            const angleDegrees =
                interaction.axis === "xy"
                    ? radialAngleDegrees
                    : (interaction.axis === "x" ? deltaX : deltaY) * 0.5;
            const transformed = interaction.pivotMode === "own"
                ? rotateAnnotationsAroundOwnCenters(interaction.baseAnnotations, angleDegrees)
                : rotateAnnotationsAroundGroupCenter(interaction.baseAnnotations, angleDegrees);
            const replacements = new Map(transformed.map((annotation) => [annotation.id, annotation]));
            return annotationState().elements.map((annotation) => replacements.get(annotation.id) ?? annotation);
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
        const keepUniform = shiftPressed();
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
        return annotationState().elements.map((annotation) => replacements.get(annotation.id) ?? annotation);
    };

    const patchUnitDataLocally = (patch: Partial<Unit["data"]>) => {
        graphStore.actions.updateUnitData(props.unitId, patch);
    };

    const propagateStickerEditFromCurrentUnit = () => {
        graphStore.actions.propagateStickerEditsFrom(props.unitId);
    };

    const patchUnitData = async (
        patch: Partial<Unit["data"]>,
        options: { propagateEdit?: boolean; markLocalEdit?: boolean } = {},
    ) => {
        if (options.propagateEdit) {
            graphStore.actions.updateStickerEditData(props.unitId, patch, {
                markLocalEdit: options.markLocalEdit,
            });
            propagateStickerEditFromCurrentUnit();
        } else {
            patchUnitDataLocally(patch);
        }
        await syncService.performWorkflowSync();
    };

    const rememberCurrentState = (includeImageData = false) => {
        const currentUnit = unit();
        if (!currentUnit) return;
        uiActions.pushStickerHistory(
            props.unitId,
            captureStickerEditSnapshot(
                currentUnit,
                includeImageData ? { includeImageData: true } : undefined,
            ),
        );
    };

    const previewAnnotations = createMemo(() => {
        const transform = transformInteraction();
        if (transform) {
            return buildTransformPreviewAnnotations(transform);
        }

        const reshape = reshapeLine();
        if (reshape) {
            return annotationState().elements.map((annotation) =>
                annotation.id === reshape.annotationId
                    ? moveLineEndpoint(reshape.original, reshape.handle, reshape.current)
                    : annotation,
            );
        }

        const resize = resizeAnnotation();
        if (resize) {
            return annotationState().elements.map((annotation) =>
                annotation.id === resize.annotationId
                    ? resizeBoxAnnotation(resize.original, resize.handle, resize.current)
                    : annotation,
            );
        }

        const drag = dragAnnotation();
        if (!drag) return annotationState().elements;
        const deltaX = drag.current.x - drag.start.x;
        const deltaY = drag.current.y - drag.start.y;
        return annotationState().elements.map((annotation) =>
            annotation.id === drag.annotationId
                ? translateAnnotation(annotation, deltaX, deltaY)
                : annotation,
            );
    });
    const getPendingTextExistingAnnotation = (draft: PendingTextInput) =>
        draft.annotationId
            ? annotationState().elements.find(
                  (annotation): annotation is StickerTextAnnotation =>
                      annotation.id === draft.annotationId &&
                      (annotation.type === "text" || annotation.type === "serial"),
              )
            : undefined;
    const visiblePreviewAnnotations = createMemo(() => {
        const draft = pendingTextInput();
        const annotations = previewAnnotations();
        if (!draft?.annotationId) return annotations;
        return annotations.filter((annotation) => annotation.id !== draft.annotationId);
    });
    // Highlighters render as a single translucent layer so overlapping strokes
    // (and self-crossing paths) do not compound their opacity. They are split
    // out of the main annotation pass and drawn together in one <g opacity>.
    const highlighterPreviewAnnotations = createMemo(() =>
        visiblePreviewAnnotations().filter(
            (annotation): annotation is StickerLineAnnotation => annotation.type === "highlighter",
        ),
    );
    const nonHighlighterPreviewAnnotations = createMemo(() =>
        // Stable sort by render rank so censoring effects sit beneath painted
        // annotations and, among effects, blur renders below mosaic (a blur brush
        // can never paint over and erase a mosaic on the same pixels).
        visiblePreviewAnnotations()
            .filter((annotation) => annotation.type !== "highlighter")
            .map((annotation, index) => ({ annotation, index }))
            .sort(
                (a, b) =>
                    annotationRenderRank(a.annotation.type) - annotationRenderRank(b.annotation.type) ||
                    a.index - b.index,
            )
            .map((entry) => entry.annotation),
    );
    const pendingTextPreviewAnnotation = createMemo<StickerTextAnnotation | null>(() => {
        const draft = pendingTextInput();
        if (!draft || !draft.value) return null;
        const existing = getPendingTextExistingAnnotation(draft);
        return {
            id: draft.annotationId ?? "__pending_text_preview__",
            type: existing?.type ?? "text",
            zIndex: existing?.zIndex ?? annotationState().elements.length + 1,
            x: draft.x,
            y: draft.y,
            text: draft.value,
            fontSize: draft.fontSize,
            fontFamily: draft.fontFamily,
            style: {
                color: draft.color,
                width: existing?.style.width ?? stickerToolSettings.strokeWidth,
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
            ? selectedPreviewAnnotations().find((annotation) => annotation.id === selectedStickerAnnotationId())
            : undefined,
    );

    const commitAnnotation = async (annotation: StickerAnnotation, nextSerialCounter?: number) => {
        rememberCurrentState();
        await patchUnitData({
            annotationState: {
                elements: [...annotationState().elements, annotation],
                serialCounter: nextSerialCounter ?? annotationState().serialCounter,
            },
        }, { propagateEdit: true });
    };

    const pendingTextInputStyle = createMemo(() => {
        const draft = pendingTextInput();
        if (!draft) return {};
        const width = Math.max(160, props.width - draft.x);
        const height = Math.max(24, draft.fontSize + 8);
        const left = Math.min(Math.max(0, draft.x), Math.max(0, props.width - width));
        const top = Math.min(Math.max(0, draft.y - draft.fontSize), Math.max(0, props.height - height));
        return {
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
            color: "transparent",
            "caret-color": draft.color,
            "font-size": `${draft.fontSize}px`,
            "font-family": `"${draft.fontFamily}", "Segoe UI", ui-sans-serif, system-ui, sans-serif`,
            "font-weight": 500,
            "line-height": `${draft.fontSize}px`,
        };
    });

    const resolveTextAnnotationFontFamily = (annotation?: StickerTextAnnotation) =>
        annotation?.fontFamily ??
        (annotation?.type === "serial"
            ? stickerToolSettings.serialFontFamily
            : stickerToolSettings.textFontFamily);

    const beginPendingTextInput = (point: StickerPoint, existing?: StickerTextAnnotation) => {
        setPendingTextInput({
            annotationId: existing?.id,
            x: existing?.x ?? point.x,
            y: existing?.y ?? point.y,
            value: existing?.text ?? "",
            fontSize: existing?.fontSize ?? stickerToolSettings.textSize,
            color: existing?.style.color ?? stickerToolSettings.textColor,
            fontFamily: resolveTextAnnotationFontFamily(existing),
        });
        uiActions.setSelectedStickerAnnotation(existing?.id ?? null);
        setTimeout(() => {
            pendingTextInputRef?.focus();
            pendingTextInputRef?.select();
        }, 0);
    };

    const commitPendingTextInput = async () => {
        const draft = pendingTextInput();
        if (!draft) return;

        const text = draft.value.trim();
        setPendingTextInput(null);
        if (!text) return;

        if (draft.annotationId) {
            const existing = getPendingTextExistingAnnotation(draft);
            if (!existing || existing.text === text) {
                uiActions.setSelectedStickerAnnotation(draft.annotationId);
                return;
            }
            rememberCurrentState();
            await patchUnitData({
                annotationState: updateTextAnnotationById(annotationState(), draft.annotationId, text),
            }, { propagateEdit: true });
            uiActions.setSelectedStickerAnnotation(draft.annotationId);
            return;
        }

        const annotation: StickerTextAnnotation = {
            id: crypto.randomUUID(),
            type: "text",
            zIndex: annotationState().elements.length + 1,
            x: draft.x,
            y: draft.y,
            text,
            fontSize: draft.fontSize,
            fontFamily: draft.fontFamily,
            style: {
                color: draft.color,
                width: stickerToolSettings.strokeWidth,
                opacity: 1,
            },
        };
        await commitAnnotation(annotation);
        uiActions.setSelectedStickerAnnotation(annotation.id);
    };

    const handlePendingTextInputKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
        if (event.key === "Enter") {
            event.preventDefault();
            void commitPendingTextInput();
        }
        if (event.key === "Escape") {
            event.preventDefault();
            setPendingTextInput(null);
        }
    };

    // Live "erase annotations only" pipeline. The generation-token / pending-
    // buffer / runner plumbing lives in LiveEraseQueue; this owns only the
    // layer-specific state (which src we erase onto) and the per-batch work.
    const rasterizedEraseQueue = new LiveEraseQueue();
    let liveRasterizedAnnotationEraseLayerSrc: string | null = null;
    let liveRasterizedAnnotationEraseBaseLayerSrc: string | null = null;
    let liveRasterizedAnnotationEraseHistoryCaptured = false;

    const applyLiveRasterizedAnnotationErase = (points: StickerPoint[]) =>
        rasterizedEraseQueue.apply(points, async (batch, generation) => {
            if (
                !liveRasterizedAnnotationEraseLayerSrc ||
                !liveRasterizedAnnotationEraseBaseLayerSrc
            ) {
                return;
            }

            if (!liveRasterizedAnnotationEraseHistoryCaptured) {
                rememberCurrentState(true);
                liveRasterizedAnnotationEraseHistoryCaptured = true;
            }

            const nextLayerSrc = await eraseRasterizedAnnotationLayer({
                rasterizedAnnotationLayerSrc: liveRasterizedAnnotationEraseLayerSrc,
                size: { w: props.width, h: props.height },
                points: batch,
                width: stickerToolSettings.contentEraserSize,
            });
            if (
                !rasterizedEraseQueue.isCurrent(generation) ||
                !liveRasterizedAnnotationEraseBaseLayerSrc
            ) {
                return;
            }

            const previewSrc = await composeRasterizedStickerPreview(
                liveRasterizedAnnotationEraseBaseLayerSrc,
                nextLayerSrc,
                { w: props.width, h: props.height },
            );
            if (!rasterizedEraseQueue.isCurrent(generation)) {
                return;
            }

            liveRasterizedAnnotationEraseLayerSrc = nextLayerSrc;
            patchUnitDataLocally({
                rasterizedAnnotationLayerSrc: nextLayerSrc,
                previewSrc,
                resultHandle: undefined,
                filePath: undefined,
            });
        });

    const beginLiveRasterizedAnnotationErase = (point: StickerPoint) => {
        const currentUnit = unit();
        const layerSrc = currentUnit?.data.rasterizedAnnotationLayerSrc;
        const baseLayerSrc = currentUnit?.data.src || currentUnit?.data.previewSrc;
        if (!currentUnit || !layerSrc || !baseLayerSrc) return false;

        liveRasterizedAnnotationEraseLayerSrc = layerSrc;
        liveRasterizedAnnotationEraseBaseLayerSrc = baseLayerSrc;
        liveRasterizedAnnotationEraseHistoryCaptured = false;
        rasterizedEraseQueue.begin();
        void applyLiveRasterizedAnnotationErase([point]);
        return true;
    };

    const finishLiveRasterizedAnnotationErase = async () => {
        const committed = await rasterizedEraseQueue.finish();
        if (!committed) return false;

        const shouldSync = liveRasterizedAnnotationEraseHistoryCaptured;
        liveRasterizedAnnotationEraseLayerSrc = null;
        liveRasterizedAnnotationEraseBaseLayerSrc = null;
        liveRasterizedAnnotationEraseHistoryCaptured = false;
        if (shouldSync) {
            graphStore.actions.updateStickerEditData(props.unitId, {}, { markLocalEdit: true });
            propagateStickerEditFromCurrentUnit();
            await syncService.performWorkflowSync();
        }
        return true;
    };

    const commitContentErase = async (stroke: ContentEraserStroke) => {
        const currentUnit = unit();
        const layerSrc = currentUnit?.data.rasterizedAnnotationLayerSrc;
        if (!currentUnit || stroke.points.length < 1) return false;

        // The erase pipeline loads images and reads canvases back via toDataURL,
        // either of which can reject (decode failure, tainted canvas, missing
        // source). This commit runs from a void-invoked pointer handler with no
        // outer catch, so guard it here: on failure log and abort instead of
        // letting the rejection surface as an "uncaught client exception".
        try {
            const baseLayerSrc = await renderStickerBaseLayer(currentUnit);
            rememberCurrentState(true);

            if (!layerSrc) {
                const nextBaseLayerSrc = await applyContentEraseToBaseLayer({
                    baseLayerSrc,
                    size: { w: props.width, h: props.height },
                    stroke,
                });
                await patchUnitData({
                    src: nextBaseLayerSrc,
                    previewSrc: nextBaseLayerSrc,
                    resultHandle: undefined,
                    filePath: undefined,
                    imageEditState: createEmptyImageEditState(),
                }, { propagateEdit: true });
                return true;
            }

            const next = await applyRasterizedContentErase({
                baseLayerSrc,
                rasterizedAnnotationLayerSrc: layerSrc,
                size: { w: props.width, h: props.height },
                stroke,
            });

            await patchUnitData({
                src: next.baseLayerSrc,
                previewSrc: next.previewSrc,
                rasterizedAnnotationLayerSrc: next.rasterizedAnnotationLayerSrc,
                resultHandle: undefined,
                filePath: undefined,
                imageEditState: createEmptyImageEditState(),
            }, { propagateEdit: true });
            return true;
        } catch (error) {
            console.error("[Hook] Failed to commit content erase", error);
            return false;
        }
    };

    // Live "erase the image content" mode (the default content-eraser, i.e. NOT
    // the annotations-only variant). It mirrors the live rasterized-annotation
    // erase queue: capture the starting base image once on pointer-down, erase
    // each new segment incrementally onto the evolving base layer, patch the
    // preview locally per frame so the erase tracks the cursor, and only run the
    // full propagate + workflow sync once on pointer-up. Erasing the base image
    // makes those pixels transparent (destination-out), exactly like the
    // committed stroke did, but without waiting for the mouse release.
    // Live "erase the image content" mode (the default content-eraser, i.e. NOT
    // the annotations-only variant). Same LiveEraseQueue plumbing as the
    // annotations-only path; this owns the evolving base/annotation layer state
    // and the per-batch flatten-and-erase work. Erasing the base image makes
    // those pixels transparent (destination-out) live as the brush moves.
    const contentEraseQueue = new LiveEraseQueue();
    let liveContentEraseBaseLayerSrc: string | null = null;
    let liveContentEraseRasterizedAnnotationLayerSrc: string | null = null;
    let liveContentEraseHistoryCaptured = false;

    const applyLiveContentErase = (points: StickerPoint[]) =>
        contentEraseQueue.apply(points, async (batch, generation) => {
            if (!liveContentEraseBaseLayerSrc) return;

            if (!liveContentEraseHistoryCaptured) {
                rememberCurrentState(true);
                liveContentEraseHistoryCaptured = true;
            }

            const next = await applyLiveContentEraseToStickerLayers({
                baseLayerSrc: liveContentEraseBaseLayerSrc,
                rasterizedAnnotationLayerSrc:
                    liveContentEraseRasterizedAnnotationLayerSrc ?? undefined,
                size: { w: props.width, h: props.height },
                stroke: {
                    points: batch,
                    width: stickerToolSettings.contentEraserSize,
                    color: "#000000",
                    opacity: 1,
                },
            });
            if (!contentEraseQueue.isCurrent(generation)) {
                return;
            }

            liveContentEraseBaseLayerSrc = next.baseLayerSrc;
            liveContentEraseRasterizedAnnotationLayerSrc =
                next.rasterizedAnnotationLayerSrc ?? null;
            patchUnitDataLocally({
                src: next.baseLayerSrc,
                previewSrc: next.previewSrc,
                resultHandle: undefined,
                filePath: undefined,
                rasterizedAnnotationLayerSrc: next.rasterizedAnnotationLayerSrc,
                imageEditState: createEmptyImageEditState(),
            });
        });

    const beginLiveContentErase = async (point: StickerPoint) => {
        const currentUnit = unit();
        if (!currentUnit) return false;
        // Flatten the base image + any rasterized annotation layer into a single
        // base so erasing removes whatever is visible at that pixel, matching the
        // committed behavior. renderStickerBaseLayer can reject (decode/taint), so
        // guard it.
        let baseLayerSrc: string;
        try {
            baseLayerSrc = await renderStickerBaseLayer(currentUnit);
        } catch (error) {
            console.error("[Hook] Failed to start live content erase", error);
            return false;
        }
        liveContentEraseBaseLayerSrc = baseLayerSrc;
        liveContentEraseRasterizedAnnotationLayerSrc =
            currentUnit.data.rasterizedAnnotationLayerSrc ?? null;
        liveContentEraseHistoryCaptured = false;
        contentEraseQueue.begin();
        void applyLiveContentErase([point]);
        return true;
    };

    const finishLiveContentErase = async () => {
        const committed = await contentEraseQueue.finish();
        if (!committed) return false;

        const shouldSync = liveContentEraseHistoryCaptured;
        const finalSrc = liveContentEraseBaseLayerSrc;
        const finalRasterizedAnnotationLayerSrc = liveContentEraseRasterizedAnnotationLayerSrc;
        liveContentEraseBaseLayerSrc = null;
        liveContentEraseRasterizedAnnotationLayerSrc = null;
        liveContentEraseHistoryCaptured = false;
        if (shouldSync && finalSrc) {
            // Promote the locally-patched result through the propagation + sync
            // path so downstream units and persistence pick up the erased image.
            await patchUnitData({
                src: finalSrc,
                previewSrc: finalRasterizedAnnotationLayerSrc
                    ? await composeRasterizedStickerPreview(
                          finalSrc,
                          finalRasterizedAnnotationLayerSrc,
                          { w: props.width, h: props.height },
                      )
                    : finalSrc,
                resultHandle: undefined,
                filePath: undefined,
                rasterizedAnnotationLayerSrc: finalRasterizedAnnotationLayerSrc ?? undefined,
                imageEditState: createEmptyImageEditState(),
            }, { propagateEdit: true });
        }
        return true;
    };

    const applyDesktopColorPickerSample = (payload: GlobalColorPickerMousePayload, commit: boolean) => {
        if (!payload.hex || !payload.rgb) return;

        const previewX = payload.x ?? payload.globalX ?? 0;
        const previewY = payload.y ?? payload.globalY ?? 0;
        setColorPickerPreview({
            x: previewX,
            y: previewY,
            hex: payload.hex,
            rgb: payload.rgb,
        });

        if (commit) {
            uiActions.setStickerSampledColor(payload.hex);
            uiActions.setStickerSampledRgb(payload.rgb);
            uiActions.setStickerActiveColor(payload.hex);
            uiActions.recordColorHistory({ hex: payload.hex, rgb: payload.rgb });
            const returnTool = uiActions.consumeStickerColorPickerReturnMode();
            if (returnTool) {
                uiActions.setStickerActiveTool(returnTool);
            }
        }
    };

    const toLocalPoint = (event: PointerEvent): StickerPoint => {
        const rect = hostRef!.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    };

    const captureHostPointer = (pointerId: number) => {
        try {
            hostRef?.setPointerCapture(pointerId);
        } catch {
            // Synthetic overlay-routed pointer events do not always own an OS
            // pointer capture. We still track the logical active pointer locally.
        }
        setActivePointerId(pointerId);
    };

    const beginDirectTransform = (
        event: PointerEvent,
        annotations: StickerAnnotation[],
        kind: TransformInteractionKind,
        options?: {
            axis?: MoveAxisMode;
            pivotMode?: TransformPivotMode;
            selectionIds?: string[];
        },
    ) => {
        if (annotations.length < 1) return false;
        const point = toLocalPoint(event);
        const targetAnnotations = annotations;
        const annotationIds = annotations.map((annotation) => annotation.id);
        const selectionIds =
            options?.selectionIds && options.selectionIds.length > 0
                ? options.selectionIds
                : annotationIds;
        uiActions.setSelectedStickerAnnotations(selectionIds);
        captureHostPointer(event.pointerId);
        setTransformInteraction({
            kind,
            annotationIds,
            startPoint: point,
            currentPoint: point,
            baseAnnotations: targetAnnotations.map((annotation) => cloneStickerAnnotation(annotation)),
            pivotMode: options?.pivotMode ?? (targetAnnotations.length > 1 && event.shiftKey ? "own" : "group"),
            axis: options?.axis ?? "xy",
            pivot: getAnnotationGroupCenter(targetAnnotations),
        });
        return true;
    };

    const releaseHostPointer = () => {
        const pointerId = activePointerId();
        if (pointerId === null) return;
        if (hostRef?.hasPointerCapture(pointerId)) {
            hostRef.releasePointerCapture(pointerId);
        }
        setActivePointerId(null);
    };

    const isSquareConstraintActive = (event?: PointerEvent) =>
        !!event?.shiftKey || shiftPressed();
    const isRegularShapeStepSnapActive = (mode: DraftShape["mode"], event?: PointerEvent) =>
        isRegularShapeMode(mode) && (!!event?.ctrlKey || ctrlPressed());
    const isStraightLineAngleLockActive = (mode: DraftLine["mode"], event?: PointerEvent) =>
        isStraightLineMode(mode) && (!!event?.shiftKey || shiftPressed());
    const isStraightLineStepSnapActive = (mode: DraftLine["mode"], event?: PointerEvent) =>
        isStraightLineMode(mode) && (!!event?.ctrlKey || ctrlPressed());
    const getLineStrokeColor = (mode: DraftLine["mode"]) =>
        mode === "line" || mode === "arrow"
            ? stickerToolSettings.lineStrokeColor
            : mode === "brush" || mode === "highlighter"
              ? stickerToolSettings.brushColor
            : getEffectiveStickerColor(stickerColorState);
    const isHighlighterLineMode = (mode: DraftLine["mode"]) =>
        mode === "highlighter" || (mode === "brush" && stickerToolSettings.brushHighlighterEnabled);

    const onPointerMove = (event: PointerEvent) => {
        if (transformInteraction()) {
            const point = toLocalPoint(event);
            setTransformInteraction((prev) =>
                prev
                    ? {
                          ...prev,
                          currentPoint: point,
                      }
                    : prev,
            );
            return;
        }

        if (reshapeLine()) {
            const point = toLocalPoint(event);
            setReshapeLine((prev) => (prev ? { ...prev, current: point } : prev));
            return;
        }

        if (resizeAnnotation()) {
            const point = toLocalPoint(event);
            setResizeAnnotation((prev) => (prev ? { ...prev, current: point } : prev));
            return;
        }

        if (dragAnnotation()) {
            const point = toLocalPoint(event);
            setDragAnnotation((prev) => (prev ? { ...prev, current: point } : prev));
            return;
        }

        if (draftShape()) {
            setDraftShape((prev) => {
                if (!prev) return prev;
                const nextPoint = toLocalPoint(event);
                if (isBoundedBoxMode(prev.mode)) {
                    const constrainSquare =
                        isRegularShapeMode(prev.mode) && (stickerToolSettings.shapeConstrainSquare || isSquareConstraintActive(event));
                    const effectiveSnapStep = stickerToolSettings.shapeSnapStep > 0
                        ? stickerToolSettings.shapeSnapStep
                        : isRegularShapeStepSnapActive(prev.mode, event) ? 10 : undefined;
                    const clampedRect = constrainSquare
                        ? clampShapeRectToStickerBounds(
                              prev.start,
                              nextPoint,
                              { w: props.width, h: props.height },
                              true,
                              effectiveSnapStep,
                          )
                        : isRegularShapeMode(prev.mode)
                          ? clampShapeRectToStickerBounds(
                                prev.start,
                                nextPoint,
                                { w: props.width, h: props.height },
                                false,
                                effectiveSnapStep,
                            )
                          : clampCropRectToStickerBounds(
                                prev.start,
                                nextPoint,
                                { w: props.width, h: props.height },
                            );
                    return {
                        ...prev,
                        constrainSquare,
                        snapStep: effectiveSnapStep,
                        current: {
                            x:
                                prev.start.x <= nextPoint.x
                                    ? clampedRect.x + clampedRect.w
                                    : clampedRect.x,
                            y:
                                prev.start.y <= nextPoint.y
                                    ? clampedRect.y + clampedRect.h
                                    : clampedRect.y,
                        },
                    };
                }
                return { ...prev, current: nextPoint };
            });
            return;
        }

        if (draftLine()) {
            const currentDraft = draftLine();
            const point = toLocalPoint(event);
            const shouldRenderDraftAsStraightSegment = (mode: DraftLine["mode"]) =>
                mode === "line" || mode === "arrow" || isStraightLineAngleLockActive(mode, event);
            // The line tool's "正" toggle locks the segment to 5° increments. Shift
            // still locks to 45° and takes precedence when both are active.
            const lineAngleSnapToggleActive = (mode: DraftLine["mode"]) =>
                (mode === "line" || mode === "arrow") && stickerToolSettings.lineAngleSnap;
            // The brush "步进" setting quantizes freehand points to a pixel grid so the
            // stroke follows regular steps instead of a raw smooth path. 0 = off.
            const brushSnapStep = () =>
                currentDraft?.mode === "brush" && stickerToolSettings.shapeSnapStep > 0
                    ? stickerToolSettings.shapeSnapStep
                    : 0;
            const snapPointToGrid = (value: { x: number; y: number }, step: number) =>
                step > 0
                    ? { x: Math.round(value.x / step) * step, y: Math.round(value.y / step) * step }
                    : value;
            if (currentDraft?.mode === "content-eraser" && rasterizedEraseQueue.isActive) {
                const lastPoint = currentDraft.points[currentDraft.points.length - 1] || point;
                void applyLiveRasterizedAnnotationErase([lastPoint, point]);
            }
            if (currentDraft?.mode === "content-eraser" && contentEraseQueue.isActive) {
                const lastPoint = currentDraft.points[currentDraft.points.length - 1] || point;
                void applyLiveContentErase([lastPoint, point]);
            }
            setDraftLine((prev) =>
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
                                      ? constrainLinearToolEndpoint(prev.points[0], point, {
                                            snapStep: 10,
                                        })
                                      : brushSnapStep() > 0
                                        ? snapPointToGrid(point, brushSnapStep())
                                        : point,
                              ],
                          }
                    : prev,
            );
        }
    };

    const onPointerUp = async () => {
        releaseHostPointer();
        const transform = transformInteraction();
        const reshape = reshapeLine();
        const resize = resizeAnnotation();
        const drag = dragAnnotation();
        const shape = draftShape();
        const line = draftLine();
        setTransformInteraction(null);
        setReshapeLine(null);
        setResizeAnnotation(null);
        setDragAnnotation(null);
        setDraftShape(null);
        setDraftLine(null);

        if (transform) {
            rememberCurrentState();
            const nextElements = buildTransformPreviewAnnotations(transform);
            await patchUnitData({
                annotationState: {
                    ...annotationState(),
                    elements: nextElements,
                },
            }, { propagateEdit: true });
            uiActions.setSelectedStickerAnnotations(transform.annotationIds);
            return;
        }

        if (reshape) {
            const nextLine = moveLineEndpoint(reshape.original, reshape.handle, reshape.current);
            rememberCurrentState();
            const nextElements = annotationState().elements.map((annotation) =>
                annotation.id === reshape.annotationId ? nextLine : annotation,
            );
            await patchUnitData({
                annotationState: {
                    ...annotationState(),
                    elements: nextElements,
                },
            }, { propagateEdit: true });
            uiActions.setSelectedStickerAnnotation(reshape.annotationId);
            return;
        }

        if (resize) {
            const resized = resizeBoxAnnotation(resize.original, resize.handle, resize.current);
            rememberCurrentState();
            const nextElements = annotationState().elements.map((annotation) =>
                annotation.id === resize.annotationId ? resized : annotation,
            );
            await patchUnitData({
                annotationState: {
                    ...annotationState(),
                    elements: nextElements,
                },
            }, { propagateEdit: true });
            uiActions.setSelectedStickerAnnotation(resize.annotationId);
            return;
        }

        if (drag) {
            const deltaX = drag.current.x - drag.start.x;
            const deltaY = drag.current.y - drag.start.y;
            if (Math.abs(deltaX) >= 1 || Math.abs(deltaY) >= 1) {
                const nextElements = annotationState().elements.map((annotation) =>
                    annotation.id === drag.annotationId
                        ? translateAnnotation(annotation, deltaX, deltaY)
                        : annotation,
                );
                rememberCurrentState();
                await patchUnitData({
                    annotationState: {
                        ...annotationState(),
                        elements: nextElements,
                    },
                }, { propagateEdit: true });
            }
            return;
        }

        if (shape) {
            const rect =
                isBoundedBoxMode(shape.mode)
                    ? isRegularShapeMode(shape.mode) && shape.constrainSquare
                        ? clampShapeRectToStickerBounds(shape.start, shape.current, {
                              w: props.width,
                              h: props.height,
                          }, true, shape.snapStep)
                        : isRegularShapeMode(shape.mode)
                          ? clampShapeRectToStickerBounds(shape.start, shape.current, {
                                w: props.width,
                                h: props.height,
                            }, false, shape.snapStep)
                        : clampCropRectToStickerBounds(shape.start, shape.current, {
                              w: props.width,
                              h: props.height,
                          })
                    : normalizeRect(shape.start, shape.current);
            if (rect.w < 4 || rect.h < 4) return;
            if (shape.mode === "crop") {
                rememberCurrentState();
                const nextCrop = computeNextCropFrame(
                    {
                        x: unit()!.x,
                        y: unit()!.y,
                        w: unit()!.w,
                        h: unit()!.h,
                    },
                    imageEditState(),
                    rect,
                );
                graphStore.actions.updateUnit(props.unitId, nextCrop.unitRect);
                await patchUnitData({
                    imageEditState: {
                        ...imageEditState(),
                        contentEraseStrokes: imageEditState().contentEraseStrokes,
                        cropRect: nextCrop.cropRect,
                        sourceSize: nextCrop.sourceSize,
                    },
                }, { propagateEdit: true });
                return;
            }
            const cornerRadius =
                shape.mode === "shape-round-rect" && stickerToolSettings.shapeCornerRadius === 0
                    ? 12
                    : stickerToolSettings.shapeCornerRadius;
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
                zIndex: annotationState().elements.length + 1,
                ...rect,
                sides: type === "polygon" ? stickerToolSettings.polygonSides : undefined,
                style: {
                    color: getShapeStrokeColorForMode(shape.mode),
                    width: stickerToolSettings.strokeWidth,
                    opacity: 1,
                    fill: getShapeFillColorForMode(shape.mode),
                    cornerRadius,
                    dashPattern: stickerToolSettings.shapeStrokeDashPattern,
                },
            });
            return;
        }

        if (line) {
            // Content-eraser and the freehand effect brushes (mosaic/blur) commit
            // even on a single-point tap (a dab); other line tools need 2 points.
            const allowsSinglePoint =
                line.mode === "content-eraser" || line.mode === "mosaic" || line.mode === "blur";
            if (line.points.length < (allowsSinglePoint ? 1 : 2)) return;
            if (line.mode === "content-eraser") {
                if (rasterizedEraseQueue.isActive) {
                    await finishLiveRasterizedAnnotationErase();
                    return;
                }
                if (contentEraseQueue.isActive) {
                    await finishLiveContentErase();
                    return;
                }
                const stroke = {
                    ...createContentEraserStroke(
                        crypto.randomUUID(),
                        "#000000",
                        stickerToolSettings.contentEraserSize,
                        1,
                    ),
                    points: line.points,
                };
                await commitContentErase(stroke);
                return;
            }

            // Mosaic/blur are now freehand brush strokes: store the path + brush
            // width and a bounding box (for hit-testing, move, and the masked
            // overlay's source projection).
            if (line.mode === "mosaic" || line.mode === "blur") {
                const brushWidth = Math.max(1, stickerToolSettings.effectBrushSize);
                const pad = brushWidth / 2;
                // Reduce over the points instead of Math.min(...xs): a long freehand
                // stroke can exceed the argument-count limit and throw RangeError.
                let rawMinX = Infinity;
                let rawMinY = Infinity;
                let rawMaxX = -Infinity;
                let rawMaxY = -Infinity;
                for (const p of line.points) {
                    if (p.x < rawMinX) rawMinX = p.x;
                    if (p.y < rawMinY) rawMinY = p.y;
                    if (p.x > rawMaxX) rawMaxX = p.x;
                    if (p.y > rawMaxY) rawMaxY = p.y;
                }
                const minX = rawMinX - pad;
                const minY = rawMinY - pad;
                const maxX = rawMaxX + pad;
                const maxY = rawMaxY + pad;
                const effectStyle =
                    line.mode === "mosaic"
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
                    zIndex: annotationState().elements.length + 1,
                    x: minX,
                    y: minY,
                    w: Math.max(1, maxX - minX),
                    h: Math.max(1, maxY - minY),
                    points: line.points,
                    brushWidth,
                    style: effectStyle,
                    strength:
                        line.mode === "mosaic"
                            ? stickerToolSettings.mosaicSize
                            : stickerToolSettings.blurStrength,
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

            const isStraightLine = type === "line" || type === "arrow";
            // Straight lines/arrows and the plain freehand brush honor the dash
            // pattern. The highlighter is a solid marker wash, so it stays solid.
            const supportsDashPattern = isStraightLine || type === "brush";
            await commitAnnotation({
                id: crypto.randomUUID(),
                type,
                zIndex: annotationState().elements.length + 1,
                points: line.points,
                style: {
                    color: getLineStrokeColor(line.mode),
                    width: stickerToolSettings.strokeWidth,
                    opacity: isHighlighterLineMode(line.mode) ? HIGHLIGHTER_LAYER_OPACITY : 1,
                    dashPattern: supportsDashPattern ? stickerToolSettings.shapeStrokeDashPattern : undefined,
                },
            });
        }
    };

    const handleExistingPointerDown = async (
        event: PointerEvent,
        point: StickerPoint,
        hit: StickerAnnotation | undefined,
        currentSelectionIds: string[],
    ) => {
        const transformMode = effectiveTransformMode();
        const isHitSelected = !!hit && currentSelectionIds.includes(hit.id);
        const getSelectedTargetAnnotations = () => {
            const ids =
                hit
                    ? isHitSelected && currentSelectionIds.length > 0
                        ? currentSelectionIds
                        : [hit.id]
                    : currentSelectionIds;
            if (ids.length > 0) {
                uiActions.setSelectedStickerAnnotations(ids);
            }
            const idSet = new Set(ids);
            return annotationState().elements.filter((annotation) => idSet.has(annotation.id));
        };
        const getAnnotationsByIds = (annotationIds: string[]) => {
            const idSet = new Set(annotationIds);
            return annotationState().elements.filter((annotation) => idSet.has(annotation.id));
        };
        const resolveGizmoTransform = (): { kind: TransformInteractionKind; axis: MoveAxisMode } | null => {
            if (currentSelectionIds.length < 1) return null;
            const center = selectedAnnotationCenter();
            const pointToCenter = Math.hypot(point.x - center.x, point.y - center.y);
            const moveAxis = resolveMoveGizmoAxisAtPoint(point, center, {
                axisLength: TRANSFORM_GIZMO_AXIS_LENGTH,
                hitPadding: TRANSFORM_GIZMO_HIT_PADDING,
                centerSize: TRANSFORM_GIZMO_CENTER_SIZE,
            });
            const scaleAxis = resolveScaleGizmoAxisAtPoint(point, center, {
                axisLength: TRANSFORM_GIZMO_AXIS_LENGTH,
                hitPadding: TRANSFORM_GIZMO_HIT_PADDING,
                centerSize: TRANSFORM_GIZMO_CENTER_SIZE,
                handleSize: TRANSFORM_GIZMO_SCALE_HANDLE_SIZE,
            });
            const onRing = Math.abs(pointToCenter - TRANSFORM_GIZMO_RING_RADIUS) <= TRANSFORM_GIZMO_HIT_PADDING;

            if (transformMode === "rotate" || (transformMode === "select" && event.ctrlKey)) {
                return onRing ? { kind: "rotate", axis: "xy" } : null;
            }

            if (transformMode === "scale") {
                return scaleAxis ? { kind: "scale", axis: scaleAxis } : null;
            }

            if (transformMode === "move" || (transformMode === "select" && event.altKey)) {
                return moveAxis ? { kind: "move", axis: moveAxis } : null;
            }

            return null;
        };
        const beginTransform = (
            kind: TransformInteractionKind,
            options?: {
                annotationIds?: string[];
                axis?: MoveAxisMode;
            },
        ) => {
            const targetAnnotations =
                options?.annotationIds && options.annotationIds.length > 0
                    ? getAnnotationsByIds(options.annotationIds)
                    : getSelectedTargetAnnotations();
            if (targetAnnotations.length === 0) return false;
            return beginDirectTransform(event, targetAnnotations, kind, {
                axis: options?.axis ?? "xy",
                selectionIds: targetAnnotations.map((annotation) => annotation.id),
            });
        };

        const shouldPassThroughToStickerDrag =
            !hit &&
            transformMode === "select" &&
            currentSelectionIds.length === 0;
        if (shouldPassThroughToStickerDrag) {
            uiActions.setSelectedStickerAnnotations([]);
            uiActions.setSelectedStickerAnnotation(null);
            return;
        }

        if (hit && event.shiftKey && transformMode === "select" && !event.ctrlKey && !event.altKey) {
            const nextIds = isHitSelected
                ? currentSelectionIds.filter((annotationId) => annotationId !== hit.id)
                : [...currentSelectionIds, hit.id];
            uiActions.setSelectedStickerAnnotations(nextIds);
            return;
        }

        const gizmoTransform = resolveGizmoTransform();
        if (gizmoTransform) {
            event.stopPropagation();
            event.preventDefault();
            if (beginTransform(gizmoTransform.kind, {
                annotationIds: currentSelectionIds,
                axis: gizmoTransform.axis,
            })) {
                return;
            }
        }

        if (transformMode === "select") {
            if (event.ctrlKey && hit) {
                event.stopPropagation();
                event.preventDefault();
                if (beginTransform("rotate")) return;
            }
            if (event.altKey && hit) {
                event.stopPropagation();
                event.preventDefault();
                if (beginTransform("move")) return;
            }
            if (hit) {
                event.stopPropagation();
                event.preventDefault();
                if (beginTransform("move")) return;
            }
        }

        if (transformMode === "move") {
            if (hit || currentSelectionIds.length > 0) {
                event.stopPropagation();
                event.preventDefault();
                if (beginTransform("move")) return;
            }
        }
        if (transformMode === "rotate") {
            if (hit || currentSelectionIds.length > 0) {
                event.stopPropagation();
                event.preventDefault();
                if (beginTransform("rotate")) return;
            }
        }
        if (transformMode === "scale") {
            if (hit || currentSelectionIds.length > 0) {
                event.stopPropagation();
                event.preventDefault();
                if (beginTransform("scale")) return;
            }
        }

        event.stopPropagation();
        event.preventDefault();
        if (!hit) {
            uiActions.setSelectedStickerAnnotations([]);
            uiActions.setSelectedStickerAnnotation(null);
        }
    };

    const handleCreatePointerDown = async (event: PointerEvent, point: StickerPoint) => {
        const activeTool = stickerToolSettings.activeTool;
        event.stopPropagation();
        event.preventDefault();

        if (activeTool === "color-picker") {
            return;
        }

        if (activeTool === "text") {
            beginPendingTextInput(point);
            return;
        }

        if (activeTool === "serial") {
            const label = nextSerialLabel(annotationState());
            const serialMetrics = buildSerialAnnotationMetrics(stickerToolSettings.serialRadius);
            const annotation: StickerTextAnnotation = {
                id: crypto.randomUUID(),
                type: "serial",
                zIndex: annotationState().elements.length + 1,
                x: point.x,
                y: point.y,
                text: label,
                fontSize: serialMetrics.fontSize,
                fontFamily: stickerToolSettings.serialFontFamily,
                style: {
                    color: stickerToolSettings.serialForegroundColor,
                    width: serialMetrics.borderWidth,
                    opacity: 1,
                    fill: stickerToolSettings.serialFillColor,
                    cornerRadius: serialMetrics.radius,
                },
            };
            await commitAnnotation(annotation, annotationState().serialCounter + 1);
            return;
        }

        if (
            activeTool === "shape-rect"
            || activeTool === "shape-round-rect"
            || activeTool === "shape-ellipse"
            || activeTool === "shape-triangle"
            || activeTool === "shape-polygon"
        ) {
            captureHostPointer(event.pointerId);
            const shouldConstrainSquare = isRegularShapeMode(activeTool) && (stickerToolSettings.shapeConstrainSquare || isSquareConstraintActive(event));
            const effectiveSnapStep = stickerToolSettings.shapeSnapStep > 0
                ? stickerToolSettings.shapeSnapStep
                : isRegularShapeStepSnapActive(activeTool, event) ? 10 : undefined;
            setDraftShape({
                mode: activeTool,
                start: point,
                current: point,
                constrainSquare: shouldConstrainSquare,
                snapStep: effectiveSnapStep,
            });
            return;
        }

        if (
            activeTool === "line"
            || activeTool === "polyline"
            || activeTool === "arrow"
            || activeTool === "brush"
            || activeTool === "highlighter"
            || activeTool === "mosaic"
            || activeTool === "blur"
        ) {
            captureHostPointer(event.pointerId);
            const brushStartStep =
                activeTool === "brush" && stickerToolSettings.shapeSnapStep > 0 ? stickerToolSettings.shapeSnapStep : 0;
            const startPoint =
                brushStartStep > 0
                    ? { x: Math.round(point.x / brushStartStep) * brushStartStep, y: Math.round(point.y / brushStartStep) * brushStartStep }
                    : point;
            setDraftLine({
                mode: activeTool,
                points: [startPoint],
                showArrowHead: activeTool === "arrow" || (activeTool === "line" && stickerToolSettings.lineArrowEnabled),
            });
        }
    };

    const handleStickerPointerDown = async (event: PointerEvent, point: StickerPoint) => {
        event.stopPropagation();
        event.preventDefault();

        if (stickerToolSettings.activeCanvasTool === "content-eraser" && stickerToolSettings.contentEraserOnlyAnnotations) {
            if (beginLiveRasterizedAnnotationErase(point)) {
                captureHostPointer(event.pointerId);
                setDraftLine({
                    mode: "content-eraser",
                    points: [point],
                });
            }
            return;
        }

        if (stickerToolSettings.activeCanvasTool === "content-eraser") {
            captureHostPointer(event.pointerId);
            setDraftLine({
                mode: "content-eraser",
                points: [point],
            });
            void beginLiveContentErase(point);
            return;
        }

        if (stickerToolSettings.activeCanvasTool === "crop") {
            captureHostPointer(event.pointerId);
            setDraftShape({
                mode: "crop",
                start: point,
                current: point,
                constrainSquare: false,
            });
        }
    };

    const onPointerDown = async (event: PointerEvent) => {
        if (!interactionEnabled()) return;
        const point = toLocalPoint(event);
        const hit = findTopmostAnnotationAtPoint(annotationState().elements, point);
        const currentSelectionIds = selectedAnnotationIds();

        if (stickerToolSettings.activeTool === "color-picker") {
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        switch (stickerToolSettings.domain) {
            case "existing":
                await handleExistingPointerDown(event, point, hit, currentSelectionIds);
                return;
            case "create":
                await handleCreatePointerDown(event, point);
                return;
            case "sticker":
                if (stickerToolSettings.activeCanvasTool === "idle") {
                    await handleExistingPointerDown(event, point, hit, currentSelectionIds);
                    return;
                }
                await handleStickerPointerDown(event, point);
                return;
        }
    };

    const onWheel = async (event: WheelEvent) => {
        if (!interactionEnabled()) return;
        if (!usesExistingNodeInteractions()) {
            return;
        }
        const transformMode = effectiveTransformMode();
        if (transformMode !== "select" || !event.ctrlKey || !event.altKey) {
            return;
        }
        if (
            transformInteraction() ||
            reshapeLine() ||
            resizeAnnotation() ||
            dragAnnotation() ||
            draftShape() ||
            draftLine()
        ) {
            logWheelEvent(
                "skip-busy",
                `ctrl=${event.ctrlKey} alt=${event.altKey} shift=${event.shiftKey} transformMode=${transformMode} selectedCount=${selectedAnnotationIds().length} busy=true deltaY=${event.deltaY}`,
            );
            return;
        }

        const deltaY = event.deltaY;
        if (deltaY === 0) return;

        const rect = hostRef!.getBoundingClientRect();
        const point = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
        const hit = findTopmostAnnotationAtPoint(annotationState().elements, point);
        const currentSelectionIds = selectedAnnotationIds();
        logWheelEvent(
            "enter",
            `ctrl=${event.ctrlKey} alt=${event.altKey} shift=${event.shiftKey} transformMode=${transformMode} hit=${hit?.id ?? "none"} selected=${currentSelectionIds.join(",") || "none"} deltaY=${deltaY}`,
        );
        const annotationIds = currentSelectionIds;

        if (annotationIds.length < 1) {
            logWheelEvent(
                "bubble-no-selection",
                `ctrl=${event.ctrlKey} alt=${event.altKey} shift=${event.shiftKey} transformMode=${transformMode} hit=${hit?.id ?? "none"} selectedCount=${currentSelectionIds.length} deltaY=${deltaY}`,
            );
            return;
        }

        const idSet = new Set(annotationIds);
        const targetAnnotations = annotationState().elements.filter((annotation) => idSet.has(annotation.id));
        if (targetAnnotations.length < 1) {
            logWheelEvent(
                "bubble-no-targets",
                `ctrl=${event.ctrlKey} alt=${event.altKey} shift=${event.shiftKey} transformMode=${transformMode} annotationIds=${annotationIds.join(",")} deltaY=${deltaY}`,
            );
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        logWheelEvent(
            "consume-scale",
            `ctrl=${event.ctrlKey} alt=${event.altKey} shift=${event.shiftKey} transformMode=${transformMode} annotationIds=${annotationIds.join(",")} targetCount=${targetAnnotations.length} deltaY=${deltaY}`,
        );

        const scaleFactor = Math.max(0.5, Math.min(1.5, Math.exp(-deltaY * 0.001)));
        const scale = { x: scaleFactor, y: scaleFactor };
        const transformed =
            event.shiftKey && targetAnnotations.length > 1
                ? scaleAnnotationsAroundOwnCenters(targetAnnotations, scale)
                : scaleAnnotationsAroundGroupCenter(targetAnnotations, scale);
        const replacements = new Map(transformed.map((annotation) => [annotation.id, annotation]));

        rememberCurrentState();
        await patchUnitData({
            annotationState: {
                ...annotationState(),
                elements: annotationState().elements.map((annotation) => replacements.get(annotation.id) ?? annotation),
            },
        }, { propagateEdit: true });
        uiActions.setSelectedStickerAnnotations(annotationIds);
    };

    const draftShapeRect = createMemo(() => {
        const draft = draftShape();
        if (!draft) return null;
        return isBoundedBoxMode(draft.mode)
            ? isRegularShapeMode(draft.mode) && draft.constrainSquare
                ? clampShapeRectToStickerBounds(draft.start, draft.current, {
                      w: props.width,
                      h: props.height,
                  }, true, draft.snapStep)
                : isRegularShapeMode(draft.mode)
                  ? clampShapeRectToStickerBounds(draft.start, draft.current, {
                        w: props.width,
                        h: props.height,
                    }, false, draft.snapStep)
                  : clampCropRectToStickerBounds(draft.start, draft.current, {
                        w: props.width,
                        h: props.height,
                    })
            : normalizeRect(draft.start, draft.current);
    });
    const draftShapeMode = createMemo(() => draftShape()?.mode);
    const draftShapeMeasurement = createMemo(() => {
        const rect = draftShapeRect();
        const mode = draftShapeMode();
        if (!rect || !mode) return null;
        return buildShapeMeasurementBadge(mode, rect, { w: props.width, h: props.height });
    });
    const draftLineMeasurement = createMemo(() => {
        const draft = draftLine();
        if (!draft || !isMeasuredLineMode(draft.mode)) return null;
        return buildLineMeasurementBadge(draft.points, { w: props.width, h: props.height });
    });

    // Effect (mosaic/blur) brush draft. The MODE memo only changes when a stroke
    // starts/ends, so the <Show> keyed on it mounts the overlay (and its expensive
    // <defs> pattern/filter) exactly once per stroke. The path-data accessor reads
    // the live points so only the <path d> attribute updates per pointer move —
    // the same cheap per-frame work as the plain brush.
    const draftEffectMode = createMemo<"mosaic" | "blur" | null>(() => {
        const mode = draftLine()?.mode;
        return mode === "mosaic" || mode === "blur" ? mode : null;
    });
    const draftEffectPathData = () => {
        const draft = draftLine();
        return draft ? buildStrokePath(draft.points) : "";
    };

    const renderLinePath = (points: StickerPoint[]) =>
        points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    const renderArrowShaftPath = (points: StickerPoint[], strokeWidth: number, trimForArrow: boolean) =>
        renderLinePath(
            trimForArrow ? getArrowShaftPoints(points, {
                headLength: Math.max(24, strokeWidth * 6),
                minDistance: 2,
            }) : points,
        );
    const renderArrowHeadPath = (points: StickerPoint[]) =>
        points.length === 3
            ? `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y} L ${points[2].x} ${points[2].y} Z`
            : "";
    const renderMeasurementBadge = (badge: Accessor<MeasurementBadge>) => (
        <g style={{ "pointer-events": "none" }}>
            <rect
                x={badge().x}
                y={badge().y}
                width={badge().width}
                height={badge().height}
                rx={6}
                ry={6}
                fill="rgba(15,23,42,0.9)"
                stroke="rgba(255,255,255,0.35)"
                stroke-width={1}
            />
            <text
                x={badge().textX}
                y={badge().textY}
                fill="#ffffff"
                font-size="11"
                font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
                font-weight={700}
            >
                {badge().label}
            </text>
        </g>
    );
    const buildAnnotationRotationTransform = (
        annotation: StickerAnnotation | StickerTextAnnotation | StickerShapeAnnotation | StickerEffectAnnotation,
    ) => {
        if (!("rotation" in annotation) || !annotation.rotation) return undefined;
        const center = getAnnotationCenter(annotation);
        return `rotate(${annotation.rotation} ${center.x} ${center.y})`;
    };
    const getBoundsHandlePoints = (bounds: { x: number; y: number; w: number; h: number }) => [
        { handle: "nw" as const, x: bounds.x, y: bounds.y },
        { handle: "ne" as const, x: bounds.x + bounds.w, y: bounds.y },
        { handle: "sw" as const, x: bounds.x, y: bounds.y + bounds.h },
        { handle: "se" as const, x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    ];
    const renderSelectionBoundsRect = (bounds: { x: number; y: number; w: number; h: number }) => (
        <rect
            x={bounds.x - 4}
            y={bounds.y - 4}
            width={bounds.w + 8}
            height={bounds.h + 8}
            rx={8}
            ry={8}
            fill="none"
            stroke="rgba(255,255,255,0.8)"
            stroke-width="1.5"
            stroke-dasharray="6 4"
        />
    );
    const renderTextAnnotation = (text: Accessor<StickerTextAnnotation>) => {
        const serialMetrics = createMemo(() => buildSerialAnnotationMetrics(text().style.cornerRadius ?? 14));
        const serialFontSize = createMemo(() => text().fontSize ?? serialMetrics().fontSize);
        const serialBorderWidth = createMemo(() => text().style.width || serialMetrics().borderWidth);
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
                    font-size={text().fontSize === undefined
                        ? String(text().type === "serial" ? serialMetrics().fontSize : stickerToolSettings.textSize)
                        : String(text().fontSize)}
                    font-family={text().fontFamily ?? (text().type === "serial" ? stickerToolSettings.serialFontFamily : stickerToolSettings.textFontFamily)}
                    font-weight={text().type === "serial" ? 700 : 500}
                >
                    {text().text}
                </text>
            </g>
        );
    };
    const renderColorPickerPreview = (preview: ColorPickerPreview) => {
        const viewportWidth = typeof window === "undefined" ? 1920 : window.innerWidth;
        const viewportHeight = typeof window === "undefined" ? 1080 : window.innerHeight;
        const left = Math.min(Math.max(8, preview.x + 16), Math.max(8, viewportWidth - 152));
        const top = Math.min(Math.max(8, preview.y + 16), Math.max(8, viewportHeight - 56));

        return (
            <div
                class="pointer-events-none fixed z-[10000] rounded-lg border border-white/40 bg-slate-950/90 px-2 py-1 text-[11px] font-semibold text-white shadow-2xl"
                style={{
                    left: `${left}px`,
                    top: `${top}px`,
                    position: "fixed",
                }}
            >
                <div class="flex items-center gap-2">
                    <span
                        class="h-5 w-5 rounded border border-white/40"
                        style={{ background: preview.hex }}
                    />
                    <span>取色预览 {preview.hex}</span>
                </div>
            </div>
        );
    };
    const resolveArrowHead = (
        points: StickerPoint[],
        strokeWidth: number,
        force = false,
    ) =>
        force ? buildArrowHeadPolygon(points, {
                  headLength: Math.max(24, strokeWidth * 6),
                  headWidth: Math.max(16, strokeWidth * 5),
                  minDistance: 2,
              })
            : null;

    const lineHandlePoints = (annotation: StickerLineAnnotation) => {
        if (annotation.points.length < 2) return [];
        return [
            { handle: "start" as const, point: annotation.points[0] },
            { handle: "end" as const, point: annotation.points[annotation.points.length - 1] },
        ];
    };

    const handleDoubleClick = async (event: MouseEvent) => {
        if (!interactionEnabled()) return;
        // MouseEvent is compatible with PointerEvent for coordinate extraction
        const point = toLocalPoint(event as PointerEvent);
        const hit = findTopmostAnnotationAtPoint(annotationState().elements, point);
        if (!hit || (hit.type !== "text" && hit.type !== "serial")) return;

        event.stopPropagation();
        event.preventDefault();
        beginPendingTextInput({ x: hit.x, y: hit.y }, hit);
    };

    createEffect(() => {
        const active = interactionEnabled() && stickerToolSettings.activeTool === "color-picker";
        if (!active) {
            setColorPickerPreview(null);
            return;
        }

        let disposed = false;
        const unlisteners: Array<() => void> = [];

        void api.setCaptureInputActive(true);
        void listen<GlobalColorPickerMousePayload>("capture/global_mouse_move", (event) => {
            if (disposed) return;
            applyDesktopColorPickerSample(event.payload, false);
        })
            .then((unlisten) => {
                if (disposed) {
                    unlisten();
                    return;
                }
                unlisteners.push(unlisten);
            })
            .catch((error) => {
                console.warn("[Hook] Failed to listen for desktop color picker moves", error);
            });
        void listen<GlobalColorPickerMousePayload>("capture/global_mouse_down", (event) => {
            if (disposed) return;
            applyDesktopColorPickerSample(event.payload, true);
        })
            .then((unlisten) => {
                if (disposed) {
                    unlisten();
                    return;
                }
                unlisteners.push(unlisten);
            })
            .catch((error) => {
                console.warn("[Hook] Failed to listen for desktop color picker clicks", error);
            });

        onCleanup(() => {
            disposed = true;
            unlisteners.forEach((unlisten) => unlisten());
            setColorPickerPreview(null);
            void api.setCaptureInputActive(false);
        });
    });

    createEffect(() => {
        stickerEditCancelToken();
        if (rasterizedEraseQueue.isActive) {
            void finishLiveRasterizedAnnotationErase();
        }
        if (contentEraseQueue.isActive) {
            void finishLiveContentErase();
        }
        setDraftShape(null);
        setDraftLine(null);
        setDragAnnotation(null);
        setResizeAnnotation(null);
        setReshapeLine(null);
        setPendingTextInput(null);
    });

    createEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Control") {
                setCtrlPressed(true);
            }
            if (event.key === "Shift") {
                setShiftPressed(true);
            }
            if (event.key === "Alt") {
                setAltPressed(true);
            }
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Control") {
                setCtrlPressed(false);
            }
            if (event.key === "Shift") {
                setShiftPressed(false);
            }
            if (event.key === "Alt") {
                setAltPressed(false);
            }
        };
        const handleBlur = () => {
            setCtrlPressed(false);
            setShiftPressed(false);
            setAltPressed(false);
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);

        onCleanup(() => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        });
    });

    return (
        <div
            ref={hostRef}
            class="absolute inset-0 z-[16]"
            data-sticker-interaction-root="true"
            style={{
                "pointer-events": interactionEnabled() ? "auto" : "none",
                "overflow": cropClipped() ? "hidden" : "visible",
            }}
            onPointerDown={(event) =>
                void onPointerDown(event).catch((error) =>
                    console.error("[Hook] Sticker pointer-down handler failed", error),
                )
            }
            onPointerMove={onPointerMove}
            onPointerUp={() =>
                void onPointerUp().catch((error) =>
                    console.error("[Hook] Sticker pointer-up handler failed", error),
                )
            }
            onPointerCancel={() =>
                void onPointerUp().catch((error) =>
                    console.error("[Hook] Sticker pointer-cancel handler failed", error),
                )
            }
            onWheel={(event) =>
                void onWheel(event).catch((error) =>
                    console.error("[Hook] Sticker wheel handler failed", error),
                )
            }
            onDblClick={(event) =>
                void handleDoubleClick(event).catch((error) =>
                    console.error("[Hook] Sticker double-click handler failed", error),
                )
            }
        >
            <svg
                class="absolute inset-0 h-full w-full"
                style={{
                    "overflow": cropClipped() ? "hidden" : "visible",
                }}
            >
                <For each={imageEditState().contentEraseStrokes}>
                    {(stroke) => (
                        <path
                            d={renderLinePath(stroke.points)}
                            stroke={stroke.color}
                            stroke-width={stroke.width}
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            fill="none"
                            opacity={stroke.opacity}
                        />
                    )}
                </For>

                <g opacity={HIGHLIGHTER_LAYER_OPACITY}>
                    <For each={highlighterPreviewAnnotations()}>
                        {(annotation) => {
                            const line = annotation as StickerLineAnnotation;
                            return (
                                <path
                                    d={renderArrowShaftPath(line.points, line.style.width || 2, false)}
                                    stroke={line.style.color}
                                    stroke-width={line.style.width}
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    fill="none"
                                />
                            );
                        }}
                    </For>
                </g>

                <For each={nonHighlighterPreviewAnnotations()}>
                    {(annotation) => (
                        <Dynamic
                            component={() => {
                                switch (annotation.type) {
                                    case "rect":
                                    case "round-rect":
                                    case "ellipse":
                                    case "triangle":
                                    case "polygon": {
                                        const shape = annotation as StickerShapeAnnotation;
                                        const rotationTransform = buildAnnotationRotationTransform(shape);
                                        const common = {
                                            stroke: getVisibleStroke(shape.style.color, shape.style.width),
                                            "stroke-width": shape.style.width,
                                            fill: getVisibleFill(shape.style.fill),
                                            "stroke-dasharray": getStrokeDashArray(shape.style.dashPattern),
                                            opacity: shape.style.opacity ?? 1,
                                        };
                                        if (shape.type === "ellipse") {
                                            return (
                                                <g transform={rotationTransform}>
                                                    <ellipse
                                                        cx={shape.x + shape.w / 2}
                                                        cy={shape.y + shape.h / 2}
                                                        rx={shape.w / 2}
                                                        ry={shape.h / 2}
                                                        {...common}
                                                    />
                                                </g>
                                            );
                                        }
                                        if (shape.type === "triangle") {
                                            return (
                                                <g transform={rotationTransform}>
                                                    <path
                                                        d={buildRoundedPolygonPath(
                                                            buildTrianglePoints(shape),
                                                            getAnnotationCornerRadius(shape),
                                                        )}
                                                        {...common}
                                                    />
                                                </g>
                                            );
                                        }
                                        if (shape.type === "polygon") {
                                            return (
                                                <g transform={rotationTransform}>
                                                    <path
                                                        d={buildRoundedPolygonPath(
                                                            buildPolygonPoints(
                                                                shape,
                                                                shape.sides ?? stickerToolSettings.polygonSides,
                                                            ),
                                                            getAnnotationCornerRadius(shape),
                                                        )}
                                                        {...common}
                                                    />
                                                </g>
                                            );
                                        }
                                        return (
                                            <g transform={rotationTransform}>
                                                <rect
                                                    x={shape.x}
                                                    y={shape.y}
                                                    width={shape.w}
                                                    height={shape.h}
                                                    rx={getAnnotationCornerRadius(shape)}
                                                    ry={getAnnotationCornerRadius(shape)}
                                                    {...common}
                                                />
                                            </g>
                                        );
                                    }
                                    case "text":
                                    case "serial": {
                                        return renderTextAnnotation(() => annotation as StickerTextAnnotation);
                                    }
                                    case "mosaic":
                                    case "blur": {
                                        const effect = annotation as StickerEffectAnnotation;
                                        const effectPoints =
                                            effect.points && effect.points.length > 0
                                                ? effect.points
                                                : [
                                                      { x: effect.x, y: effect.y },
                                                      { x: effect.x + effect.w, y: effect.y + effect.h },
                                                  ];
                                        const rotationTransform = buildAnnotationRotationTransform(effect);
                                        return (
                                            <g transform={rotationTransform}>
                                                {renderStickerEffectOverlay({
                                                    x: effect.x,
                                                    y: effect.y,
                                                    w: effect.w,
                                                    h: effect.h,
                                                    points: effectPoints,
                                                    brushWidth: effect.brushWidth || effect.style.width || 20,
                                                    maskId: `sticker-effect-mask-${effect.id}`,
                                                    effectType: effect.type,
                                                    strength: effect.strength || 8,
                                                    imageSrc: props.imageSrc,
                                                    stickerWidth: props.width,
                                                    stickerHeight: props.height,
                                                })}
                                            </g>
                                        );
                                    }
                                    default: {
                                        const line = annotation as StickerLineAnnotation;
                                        const path = renderArrowShaftPath(
                                            line.points,
                                            line.style.width || 2,
                                            line.type === "arrow",
                                        );
                                        const arrowHead = resolveArrowHead(
                                            line.points,
                                            line.style.width || 2,
                                            line.type === "arrow",
                                        );
                                        return (
                                            <g>
                                                <path
                                                    d={path}
                                                    stroke={line.style.color}
                                                    stroke-width={line.style.width}
                                                    stroke-linecap={
                                                        getStrokeDashArray(line.style.dashPattern) ? "butt" : "round"
                                                    }
                                                    stroke-linejoin="round"
                                                    stroke-dasharray={getStrokeDashArray(line.style.dashPattern)}
                                                    fill="none"
                                                    opacity={line.style.opacity ?? 1}
                                                />
                                                {arrowHead ? (
                                                    <path
                                                        d={renderArrowHeadPath(arrowHead)}
                                                        fill={line.style.color}
                                                        opacity={line.style.opacity ?? 1}
                                                    />
                                                ) : null}
                                            </g>
                                        );
                                    }
                                }
                            }}
                        />
                    )}
                </For>

                <Show when={pendingTextPreviewAnnotation()} keyed>
                    {(preview) => renderTextAnnotation(() => preview)}
                </Show>

                <Show
                    when={selectedPreviewAnnotations().length > 1}
                    fallback={
                        <Show when={selectedPreviewAnnotation()} keyed>
                            {(value) => {
                                if ("points" in value && Array.isArray(value.points)) {
                                    return (
                                        <g>
                                            <path
                                                d={renderLinePath(value.points)}
                                                stroke="rgba(255,255,255,0.9)"
                                                stroke-width={(value.style.width || 2) + 6}
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                fill="none"
                                                opacity={0.25}
                                            />
                                            <Show when={stickerToolSettings.transformMode === "select" && (value.type === "line" || value.type === "arrow" || value.type === "polyline")}>
                                                <For each={lineHandlePoints(value as StickerLineAnnotation)}>
                                                    {(handle) => (
                                                        <circle
                                                            cx={handle.point.x}
                                                            cy={handle.point.y}
                                                            r="5"
                                                            fill="#ffffff"
                                                            stroke="rgba(15,23,42,0.95)"
                                                            stroke-width="1.5"
                                                            style={{ cursor: "move" }}
                                                            onPointerDown={(event) => {
                                                                event.stopPropagation();
                                                                event.preventDefault();
                                                                captureHostPointer(event.pointerId);
                                                                uiActions.setSelectedStickerAnnotation(value.id);
                                                                setReshapeLine({
                                                                    annotationId: value.id,
                                                                    handle: handle.handle,
                                                                    current: toLocalPoint(event),
                                                                    original: value,
                                                                });
                                                            }}
                                                        />
                                                    )}
                                                </For>
                                            </Show>
                                        </g>
                                    );
                                }

                                if ("w" in value && "h" in value) {
                                    const bounds = getAnnotationBounds(value as StickerShapeAnnotation | StickerEffectAnnotation);
                                    return (
                                        <g>
                                            {renderSelectionBoundsRect(bounds)}
                                            <Show when={stickerToolSettings.transformMode === "select" && !("rotation" in value && !!value.rotation)}>
                                                <For each={getBoundsHandlePoints(bounds)}>
                                                    {(handle) => (
                                                        <circle
                                                            cx={handle.x}
                                                            cy={handle.y}
                                                            r="5"
                                                            fill="#ffffff"
                                                            stroke="rgba(15,23,42,0.95)"
                                                            stroke-width="1.5"
                                                            style={{ cursor: `${handle.handle}-resize` }}
                                                            onPointerDown={(event) => {
                                                                event.stopPropagation();
                                                                event.preventDefault();
                                                                captureHostPointer(event.pointerId);
                                                                uiActions.setSelectedStickerAnnotation(value.id);
                                                                setResizeAnnotation({
                                                                    annotationId: value.id,
                                                                    handle: handle.handle,
                                                                    current: toLocalPoint(event),
                                                                    original: value,
                                                                });
                                                            }}
                                                        />
                                                    )}
                                                </For>
                                            </Show>
                                        </g>
                                    );
                                }

                                const textAnnotation = value as StickerTextAnnotation;
                                const bounds = getAnnotationBounds(textAnnotation);
                                return (
                                    <g>
                                        {renderSelectionBoundsRect(bounds)}
                                        <Show when={stickerToolSettings.transformMode === "select"}>
                                            <For each={getBoundsHandlePoints(bounds)}>
                                                {(handle) => (
                                                    <circle
                                                        cx={handle.x}
                                                        cy={handle.y}
                                                        r="5"
                                                        fill="#ffffff"
                                                        stroke="rgba(15,23,42,0.95)"
                                                        stroke-width="1.5"
                                                        style={{ cursor: `${handle.handle}-resize` }}
                                                        onPointerDown={(event) => {
                                                            event.stopPropagation();
                                                            event.preventDefault();
                                                            beginDirectTransform(event, [value], "scale", { axis: "xy" });
                                                        }}
                                                    />
                                                )}
                                            </For>
                                        </Show>
                                    </g>
                                );
                            }}
                        </Show>
                    }
                >
                    <g>
                        <For each={selectedPreviewAnnotations()}>
                            {(annotation) => (
                                <g>
                                    {renderSelectionBoundsRect(getAnnotationBounds(annotation))}
                                </g>
                            )}
                        </For>
                        <Show when={selectedPreviewGroupBounds()}>
                            {(bounds) => (
                                <g>
                                    {renderSelectionBoundsRect(bounds())}
                                    <Show when={stickerToolSettings.transformMode === "select"}>
                                        <For each={getBoundsHandlePoints(bounds())}>
                                            {(handle) => (
                                                <circle
                                                    cx={handle.x}
                                                    cy={handle.y}
                                                    r="5"
                                                    fill="#ffffff"
                                                    stroke="rgba(15,23,42,0.95)"
                                                    stroke-width="1.5"
                                                    style={{ cursor: `${handle.handle}-resize` }}
                                                    onPointerDown={(event) => {
                                                        event.stopPropagation();
                                                        event.preventDefault();
                                                        beginDirectTransform(event, selectedPreviewAnnotations(), "scale", {
                                                            axis: "xy",
                                                            selectionIds: selectedAnnotationIds(),
                                                        });
                                                    }}
                                                />
                                            )}
                                        </For>
                                    </Show>
                                </g>
                            )}
                        </Show>
                    </g>
                </Show>

                <Show when={interactionEnabled() && (showMoveAxesGizmo() || showScaleGizmo() || showRotateGizmo())}>
                    <g style={{ "pointer-events": "none" }}>
                        <Show when={showMoveAxesGizmo()}>
                            <g>
                                <line
                                    x1={selectedAnnotationCenter().x - TRANSFORM_GIZMO_AXIS_LENGTH}
                                    y1={selectedAnnotationCenter().y}
                                    x2={selectedAnnotationCenter().x + TRANSFORM_GIZMO_AXIS_LENGTH}
                                    y2={selectedAnnotationCenter().y}
                                    stroke="rgba(248,113,113,0.9)"
                                    stroke-width="2"
                                />
                                <line
                                    x1={selectedAnnotationCenter().x}
                                    y1={selectedAnnotationCenter().y - TRANSFORM_GIZMO_AXIS_LENGTH}
                                    x2={selectedAnnotationCenter().x}
                                    y2={selectedAnnotationCenter().y + TRANSFORM_GIZMO_AXIS_LENGTH}
                                    stroke="rgba(74,222,128,0.9)"
                                    stroke-width="2"
                                />
                                <rect
                                    x={selectedAnnotationCenter().x - 5}
                                    y={selectedAnnotationCenter().y - 5}
                                    width="10"
                                    height="10"
                                    rx="2"
                                    ry="2"
                                    fill="rgba(255,255,255,0.92)"
                                    stroke="rgba(15,23,42,0.85)"
                                    stroke-width="1.25"
                                />
                            </g>
                        </Show>
                        <Show when={showScaleGizmo()}>
                            <g>
                                <line
                                    x1={selectedAnnotationCenter().x}
                                    y1={selectedAnnotationCenter().y}
                                    x2={selectedAnnotationCenter().x + TRANSFORM_GIZMO_AXIS_LENGTH}
                                    y2={selectedAnnotationCenter().y}
                                    stroke="rgba(248,113,113,0.9)"
                                    stroke-width="2"
                                />
                                <line
                                    x1={selectedAnnotationCenter().x}
                                    y1={selectedAnnotationCenter().y}
                                    x2={selectedAnnotationCenter().x}
                                    y2={selectedAnnotationCenter().y + TRANSFORM_GIZMO_AXIS_LENGTH}
                                    stroke="rgba(74,222,128,0.9)"
                                    stroke-width="2"
                                />
                                <rect
                                    x={scaleGizmoHandles().center.x}
                                    y={scaleGizmoHandles().center.y}
                                    width={scaleGizmoHandles().center.w}
                                    height={scaleGizmoHandles().center.h}
                                    rx="2"
                                    ry="2"
                                    fill="rgba(255,255,255,0.92)"
                                    stroke="rgba(15,23,42,0.85)"
                                    stroke-width="1.25"
                                />
                                <rect
                                    x={scaleGizmoHandles().x.x}
                                    y={scaleGizmoHandles().x.y}
                                    width={scaleGizmoHandles().x.w}
                                    height={scaleGizmoHandles().x.h}
                                    rx="2"
                                    ry="2"
                                    fill="rgba(248,113,113,0.95)"
                                    stroke="rgba(15,23,42,0.85)"
                                    stroke-width="1.25"
                                />
                                <rect
                                    x={scaleGizmoHandles().y.x}
                                    y={scaleGizmoHandles().y.y}
                                    width={scaleGizmoHandles().y.w}
                                    height={scaleGizmoHandles().y.h}
                                    rx="2"
                                    ry="2"
                                    fill="rgba(74,222,128,0.95)"
                                    stroke="rgba(15,23,42,0.85)"
                                    stroke-width="1.25"
                                />
                            </g>
                        </Show>
                        <Show when={showRotateGizmo()}>
                            <circle
                                cx={selectedAnnotationCenter().x}
                                cy={selectedAnnotationCenter().y}
                                r={TRANSFORM_GIZMO_RING_RADIUS}
                                fill="none"
                                stroke="rgba(96,165,250,0.9)"
                                stroke-width="2"
                                stroke-dasharray="5 3"
                            />
                        </Show>
                    </g>
                </Show>

                {/* Effect (mosaic/blur) brush draft, kept in its own <Show> keyed on
                    the MODE so the overlay's expensive <defs> mount once per stroke;
                    only the <path d> updates per pointer move. */}
                <Show when={draftEffectMode()}>
                    {(mode) => (
                        <StickerEffectDraftOverlay
                            effectType={mode()}
                            pathData={draftEffectPathData}
                            brushWidth={stickerToolSettings.effectBrushSize}
                            strength={
                                mode() === "mosaic"
                                    ? stickerToolSettings.mosaicSize
                                    : stickerToolSettings.blurStrength
                            }
                            imageSrc={props.imageSrc}
                            stickerWidth={props.width}
                            stickerHeight={props.height}
                        />
                    )}
                </Show>

                <Show when={!draftEffectMode() ? draftLine() : null}>
                    {(draftValue) => {
                        // Read the draft through the <Show> accessor (guaranteed
                        // non-null while mounted) instead of draftLine()!. When the
                        // pointer lifts and draftLine() flips to null, the raw
                        // non-null assertion would re-run these reactive reads before
                        // the <Show> tears down and crash on null.mode.
                        const draft = () => draftValue();
                        const strokeColor =
                            draft().mode === "content-eraser"
                                ? "rgba(255,255,255,0.85)"
                                : getLineStrokeColor(draft().mode);
                        const strokeWidth =
                            draft().mode === "content-eraser"
                                ? stickerToolSettings.contentEraserSize
                                : stickerToolSettings.strokeWidth;
                        const hidesLiveAnnotationErasePreview =
                            draft().mode === "content-eraser" && rasterizedEraseQueue.isActive;
                        // Straight line/arrow drafts and the plain brush honor the
                        // selected dash pattern so the live preview matches what gets
                        // committed. The highlighter stays solid.
                        const previewDashArray = () =>
                            draft().mode === "line" ||
                            draft().mode === "arrow" ||
                            (draft().mode === "brush" && !stickerToolSettings.brushHighlighterEnabled)
                                ? getStrokeDashArray(stickerToolSettings.shapeStrokeDashPattern)
                                : undefined;
                        const isHighlighterDraft = isHighlighterLineMode(draft().mode);
                        return (
                            <g>
                                <Show when={!hidesLiveAnnotationErasePreview}>
                                    <Show
                                        when={isHighlighterDraft}
                                        fallback={
                                            <path
                                                d={renderArrowShaftPath(
                                                    draft().points,
                                                    strokeWidth,
                                                    !!draft().showArrowHead,
                                                )}
                                                stroke={strokeColor}
                                                stroke-width={strokeWidth}
                                                stroke-linecap={previewDashArray() ? "butt" : "round"}
                                                stroke-linejoin="round"
                                                stroke-dasharray={previewDashArray()}
                                                fill="none"
                                                opacity={1}
                                            />
                                        }
                                    >
                                        {/* Mirror the committed highlighter wash: one solid
                                            same-color stroke, the whole group at
                                            HIGHLIGHTER_LAYER_OPACITY. */}
                                        <g opacity={HIGHLIGHTER_LAYER_OPACITY}>
                                            <path
                                                d={renderArrowShaftPath(draft().points, strokeWidth, false)}
                                                stroke={strokeColor}
                                                stroke-width={strokeWidth}
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                fill="none"
                                            />
                                        </g>
                                    </Show>
                                </Show>
                                <Show
                                    when={
                                        draft().showArrowHead
                                            ? resolveArrowHead(
                                                  draft().points,
                                                  strokeWidth,
                                                  true,
                                              )
                                            : null
                                    }
                                >
                                    {(arrowHead) => (
                                        <path
                                            d={renderArrowHeadPath(arrowHead())}
                                            fill={strokeColor}
                                            opacity={isHighlighterLineMode(draft().mode) ? 0.35 : 1}
                                        />
                                    )}
                                </Show>
                            </g>
                        );
                    }}
                </Show>

                <Show when={draftShapeRect()}>
                    {(draftRect) => (
                        <Show
                            when={draftShapeMode() === "shape-ellipse"}
                            fallback={
                                <Show
                                    when={draftShapeMode() === "shape-triangle"}
                                    fallback={
                                        <Show
                                            when={draftShapeMode() === "shape-polygon"}
                                            fallback={
                                                <rect
                                                    x={draftRect().x}
                                                    y={draftRect().y}
                                                    width={draftRect().w}
                                                    height={draftRect().h}
                                                    rx={getShapeCornerRadius(draftShapeMode())}
                                                    ry={getShapeCornerRadius(draftShapeMode())}
                                                    fill={getVisibleFill(getShapeFillColorForMode("shape-rect"))}
                                                    stroke={getVisibleStroke(getShapeStrokeColorForMode("shape-rect"), stickerToolSettings.strokeWidth)}
                                                    stroke-width={stickerToolSettings.strokeWidth}
                                                    stroke-dasharray="4 2"
                                                />
                                            }
                                        >
                                            <path
                                                d={buildRoundedPolygonPath(
                                                    buildPolygonPoints(draftRect(), stickerToolSettings.polygonSides),
                                                    getShapeCornerRadius(draftShapeMode()),
                                                )}
                                                fill={getVisibleFill(getShapeFillColorForMode("shape-polygon"))}
                                                stroke={getVisibleStroke(getShapeStrokeColorForMode("shape-polygon"), stickerToolSettings.strokeWidth)}
                                                stroke-width={stickerToolSettings.strokeWidth}
                                                stroke-dasharray="4 2"
                                            />
                                        </Show>
                                    }
                                >
                                    <path
                                        d={buildRoundedPolygonPath(
                                            buildTrianglePoints(draftRect()),
                                            getShapeCornerRadius(draftShapeMode()),
                                        )}
                                        fill={getVisibleFill(getShapeFillColorForMode("shape-triangle"))}
                                        stroke={getVisibleStroke(getShapeStrokeColorForMode("shape-triangle"), stickerToolSettings.strokeWidth)}
                                        stroke-width={stickerToolSettings.strokeWidth}
                                        stroke-dasharray="4 2"
                                    />
                                </Show>
                            }
                        >
                            <ellipse
                                cx={draftRect().x + draftRect().w / 2}
                                cy={draftRect().y + draftRect().h / 2}
                                rx={draftRect().w / 2}
                                ry={draftRect().h / 2}
                                fill={getVisibleFill(getShapeFillColorForMode("shape-ellipse"))}
                                stroke={getVisibleStroke(getShapeStrokeColorForMode("shape-ellipse"), stickerToolSettings.strokeWidth)}
                                stroke-width={stickerToolSettings.strokeWidth}
                                stroke-dasharray="4 2"
                            />
                        </Show>
                    )}
                </Show>

                <Show when={draftShapeMeasurement()}>
                    {(badge) => renderMeasurementBadge(badge)}
                </Show>

                <Show when={draftLineMeasurement()}>
                    {(badge) => renderMeasurementBadge(badge)}
                </Show>
            </svg>
            <Show when={pendingTextInput()}>
                {(draft) => (
                    <input
                        ref={pendingTextInputRef}
                        class="absolute z-[20] border bg-transparent px-0 py-0 font-medium outline-none placeholder:text-[rgba(247,252,230,0.55)]"
                        style={{
                            ...pendingTextInputStyle(),
                            "border-color": "rgba(217, 255, 56, 0.65)",
                            "box-shadow": "inset 0 0 0 1px rgba(217, 255, 56, 0.2)",
                        }}
                        aria-label="输入标注文本"
                        value={draft().value}
                        placeholder="输入文本，Enter 确认"
                        onInput={(event) =>
                            setPendingTextInput((current) =>
                                current ? { ...current, value: event.currentTarget.value } : current,
                            )
                        }
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={() => void commitPendingTextInput()}
                        onKeyDown={(event) => handlePendingTextInputKeyDown(event)}
                    />
                )}
            </Show>
            <Show when={colorPickerPreview()}>
                {(preview) => (
                    <Portal>
                        {renderColorPickerPreview(preview())}
                    </Portal>
                )}
            </Show>
        </div>
    );
};
