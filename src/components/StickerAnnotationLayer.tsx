import { Component, Show, createMemo, createSignal } from "solid-js";
import { graphStore } from "../store/graphStore";
import {
    activeStickerEditTargetId,
    selectedStickerId,
    stickerToolSettings,
    uiActions,
} from "../store/uiStore";
import type { StickerTransformMode } from "../types/stickerEditing";
import {
    clampCropRectToStickerBounds,
    clampShapeRectToStickerBounds,
    createEmptyAnnotationState,
    createEmptyImageEditState,
} from "../services/stickerEditing";
import { buildLineMeasurementBadge, buildShapeMeasurementBadge } from "../services/stickerMeasurements";
import { buildStrokePath } from "./StickerEffectOverlay";
import {
    isBoundedBoxMode,
    isMeasuredLineMode,
    isRegularShapeMode,
    normalizeRect,
    type DraftLine,
    type DraftShape,
} from "./stickerAnnotationModel";
import {
    type ActiveTransformInteraction,
    type ReshapeLineState,
    type ResizeAnnotationState,
} from "./stickerAnnotationTransformController";
import { createStickerAnnotationPersistence } from "./stickerAnnotationPersistenceController";
import { createStickerAnnotationTextController } from "./stickerAnnotationTextController";
import { createStickerAnnotationEraseController } from "./stickerAnnotationEraseController";
import { StickerAnnotationElements } from "./StickerAnnotationElements";
import { StickerAnnotationSelectionOverlay } from "./StickerAnnotationSelectionOverlay";
import { StickerAnnotationDraftOverlays } from "./StickerAnnotationDraftOverlays";
import { StickerDesktopColorPickerOverlay } from "./StickerDesktopColorPickerOverlay";
import { createStickerAnnotationPointerRuntime } from "./stickerAnnotationPointerRuntime";
import { createStickerAnnotationPointerCommitController } from "./stickerAnnotationPointerCommitController";
import { createStickerAnnotationPointerDownController } from "./stickerAnnotationPointerDownController";
import { createStickerAnnotationViewModel } from "./stickerAnnotationViewModel";
import { createStickerAnnotationWheelController } from "./stickerAnnotationWheelController";
import { createStickerAnnotationLifecycleController } from "./stickerAnnotationLifecycleController";
import {
    sanitizeCanvasDimension,
    sanitizePolygonSides,
} from "./stickerAnnotationNumericSafety";

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
export const StickerAnnotationLayer: Component<StickerAnnotationLayerProps> = (props) => {
    const pointerRuntime = createStickerAnnotationPointerRuntime();
    const {
        captureHostPointer,
        dispose: disposePointerRuntime,
        host,
        resetHostBounds,
        setHostRef,
        setSelectionOverlayRef,
        toLocalPoint,
    } = pointerRuntime;
    const [draftShape, setDraftShape] = createSignal<DraftShape | null>(null);
    const [draftLine, setDraftLine] = createSignal<DraftLine | null>(null);
    const [ctrlPressed, setCtrlPressed] = createSignal(false);
    const [shiftPressed, setShiftPressed] = createSignal(false);
    const [resizeAnnotation, setResizeAnnotation] = createSignal<ResizeAnnotationState | null>(null);
    const [reshapeLine, setReshapeLine] = createSignal<ReshapeLineState | null>(null);
    const [altPressed, setAltPressed] = createSignal(false);
    const [transformInteraction, setTransformInteraction] = createSignal<ActiveTransformInteraction | null>(null);
    const stickerWidth = createMemo(() => sanitizeCanvasDimension(props.width));
    const stickerHeight = createMemo(() => sanitizeCanvasDimension(props.height));

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
    const {
        commitAnnotation,
        commitAnnotationElements,
        patchUnitData,
        rememberCurrentState,
    } = createStickerAnnotationPersistence({
        unitId: () => props.unitId,
        unit,
        annotationState,
    });
    const {
        beginPendingTextInput,
        commitPendingTextInput,
        getPendingTextExistingAnnotation,
        handlePendingTextInputKeyDown,
        pendingTextInput,
        pendingTextInputStyle,
        setPendingTextInput,
        setPendingTextInputRef,
    } = createStickerAnnotationTextController({
        width: () => stickerWidth(),
        height: () => stickerHeight(),
        annotationState,
        commitAnnotation,
        patchUnitData,
        rememberCurrentState,
    });
    const {
        appendLiveErasePoint,
        beginLiveContentErase,
        beginLiveRasterizedAnnotationErase,
        commitContentErase,
        finishActiveLiveErase,
        liveErasePreviewVisible,
        liveEraseStrokePoints,
        resetLiveEraseRuntime,
        setLiveErasePreviewRef,
    } = createStickerAnnotationEraseController({
        host,
        width: () => stickerWidth(),
        height: () => stickerHeight(),
        unit,
        patchUnitData,
        rememberCurrentState,
    });

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
    const isStickerSelectionFallback = createMemo(
        () =>
            stickerToolSettings.domain === "sticker" &&
            stickerToolSettings.activeCanvasTool === "idle",
    );
    const usesExistingNodeInteractions = createMemo(
        () => stickerToolSettings.domain === "existing" || isStickerSelectionFallback(),
    );
    const effectiveTransformMode = createMemo<StickerTransformMode>(() =>
        isStickerSelectionFallback() ? "select" : stickerToolSettings.transformMode,
    );
    const {
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
    } = createStickerAnnotationViewModel({
        width: () => stickerWidth(),
        height: () => stickerHeight(),
        annotationState,
        pendingTextInput,
        getPendingTextExistingAnnotation,
        transformInteraction,
        reshapeLine,
        resizeAnnotation,
        shiftPressed,
        ctrlPressed,
        altPressed,
        usesExistingNodeInteractions,
        effectiveTransformMode,
        gizmo: {
            axisLength: TRANSFORM_GIZMO_AXIS_LENGTH,
            centerSize: TRANSFORM_GIZMO_CENTER_SIZE,
            scaleHandleSize: TRANSFORM_GIZMO_SCALE_HANDLE_SIZE,
        },
    });

    const resolveDraftShapeRect = (draft: DraftShape) =>
        isBoundedBoxMode(draft.mode)
            ? isRegularShapeMode(draft.mode) && draft.constrainSquare
                ? clampShapeRectToStickerBounds(draft.start, draft.current, {
                      w: stickerWidth(),
                      h: stickerHeight(),
                  }, true, draft.snapStep)
                : isRegularShapeMode(draft.mode)
                  ? clampShapeRectToStickerBounds(draft.start, draft.current, {
                        w: stickerWidth(),
                        h: stickerHeight(),
                    }, false, draft.snapStep)
                  : clampCropRectToStickerBounds(draft.start, draft.current, {
                        w: stickerWidth(),
                        h: stickerHeight(),
                    })
            : normalizeRect(draft.start, draft.current);

    const isSquareConstraintActive = (event?: PointerEvent) =>
        !!event?.shiftKey || shiftPressed();
    const isRegularShapeStepSnapActive = (mode: DraftShape["mode"], event?: PointerEvent) =>
        isRegularShapeMode(mode) && (!!event?.ctrlKey || ctrlPressed());
    const { isPointerReleaseInFlight, onPointerMove, onPointerUp } =
        createStickerAnnotationPointerCommitController({
        width: () => stickerWidth(),
        height: () => stickerHeight(),
        unitId: () => props.unitId,
        unit,
        annotationState,
        imageEditState,
        draftShape,
        setDraftShape,
        draftLine,
        setDraftLine,
        resizeAnnotation,
        setResizeAnnotation,
        reshapeLine,
        setReshapeLine,
        transformInteraction,
        setTransformInteraction,
        ctrlPressed,
        shiftPressed,
        resolveDraftShapeRect,
        isSquareConstraintActive,
        isRegularShapeStepSnapActive,
        pointerRuntime,
        persistence: {
            commitAnnotation,
            commitAnnotationElements,
            patchUnitData,
            rememberCurrentState,
        },
        erase: {
            appendLiveErasePoint,
            commitContentErase,
            finishActiveLiveErase,
            liveErasePreviewVisible,
            liveEraseStrokePoints,
            resetLiveEraseRuntime,
        },
    });

    const { beginDirectTransform, onDoubleClick, onPointerDown } =
        createStickerAnnotationPointerDownController({
            interactionEnabled,
            isPointerReleaseInFlight,
            annotationState,
            selectedAnnotationIds,
            selectedAnnotationCenter,
            effectiveTransformMode,
            setDraftShape,
            setDraftLine,
            setTransformInteraction,
            isSquareConstraintActive,
            isRegularShapeStepSnapActive,
            gizmo: {
                axisLength: TRANSFORM_GIZMO_AXIS_LENGTH,
                ringRadius: TRANSFORM_GIZMO_RING_RADIUS,
                hitPadding: TRANSFORM_GIZMO_HIT_PADDING,
                centerSize: TRANSFORM_GIZMO_CENTER_SIZE,
                scaleHandleSize: TRANSFORM_GIZMO_SCALE_HANDLE_SIZE,
            },
            pointerRuntime,
            persistence: { commitAnnotation },
            text: { beginPendingTextInput },
            erase: {
                beginLiveContentErase,
                beginLiveRasterizedAnnotationErase,
            },
        });

    const { dispose: disposeWheelController, onWheel } = createStickerAnnotationWheelController({
        interactionEnabled,
        usesExistingNodeInteractions,
        effectiveTransformMode,
        transformInteraction,
        reshapeLine,
        resizeAnnotation,
        draftShape,
        draftLine,
        selectedAnnotationIds,
        annotationState,
        commitAnnotationElements,
    });

    const draftShapeRect = createMemo(() => {
        const draft = draftShape();
        if (!draft) return null;
        return resolveDraftShapeRect(draft);
    });
    const draftShapeMode = createMemo(() => draftShape()?.mode);
    const draftShapeMeasurement = createMemo(() => {
        const rect = draftShapeRect();
        const mode = draftShapeMode();
        if (!rect || !mode) return null;
        return buildShapeMeasurementBadge(mode, rect, { w: stickerWidth(), h: stickerHeight() });
    });
    const draftLineMeasurement = createMemo(() => {
        const draft = draftLine();
        if (!draft || !isMeasuredLineMode(draft.mode)) return null;
        return buildLineMeasurementBadge(draft.points, { w: stickerWidth(), h: stickerHeight() });
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

    createStickerAnnotationLifecycleController({
        setCtrlPressed,
        setShiftPressed,
        setAltPressed,
        setDraftShape,
        setDraftLine,
        setResizeAnnotation,
        setReshapeLine,
        setPendingTextInput,
        finishActiveLiveErase,
        resetHostBounds,
        disposeWheelController,
        disposePointerRuntime,
    });

    return (
        <div
            ref={setHostRef}
            class="absolute inset-0 z-[16]"
            data-sticker-interaction-root="true"
            data-sticker-surface-pass-through={usesExistingNodeInteractions() ? "true" : "false"}
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
                void onDoubleClick(event).catch((error) =>
                    console.error("[Hook] Sticker double-click handler failed", error),
                )
            }
        >
            <canvas
                ref={setLiveErasePreviewRef}
                class="absolute inset-0 h-full w-full"
                style={{
                    display: liveErasePreviewVisible() ? "block" : "none",
                    "pointer-events": "none",
                }}
            />
            <svg
                class="absolute inset-0 h-full w-full"
                style={{
                    "overflow": cropClipped() ? "hidden" : "visible",
                }}
            >
                <StickerAnnotationElements
                    contentEraseStrokes={imageEditState().contentEraseStrokes}
                    highlighterAnnotations={highlighterPreviewAnnotations()}
                    annotations={nonHighlighterPreviewAnnotations()}
                    imageSrc={props.imageSrc}
                    stickerWidth={stickerWidth()}
                    stickerHeight={stickerHeight()}
                    polygonSides={sanitizePolygonSides(stickerToolSettings.polygonSides)}
                    renderTextAnnotation={renderTextAnnotation}
                />

                <Show when={pendingTextPreviewAnnotation()} keyed>
                    {(preview) => renderTextAnnotation(() => preview)}
                </Show>

                <StickerAnnotationSelectionOverlay
                    setSelectionOverlayRef={setSelectionOverlayRef}
                    selectedAnnotations={selectedPreviewAnnotations()}
                    selectedAnnotation={selectedPreviewAnnotation()}
                    selectedGroupBounds={selectedPreviewGroupBounds()}
                    selectedAnnotationIds={selectedAnnotationIds()}
                    transformMode={stickerToolSettings.transformMode}
                    interactionEnabled={interactionEnabled()}
                    showMoveAxesGizmo={showMoveAxesGizmo()}
                    showScaleGizmo={showScaleGizmo()}
                    showRotateGizmo={showRotateGizmo()}
                    selectedAnnotationCenter={selectedAnnotationCenter()}
                    scaleGizmoHandles={scaleGizmoHandles()}
                    axisLength={TRANSFORM_GIZMO_AXIS_LENGTH}
                    ringRadius={TRANSFORM_GIZMO_RING_RADIUS}
                    captureHostPointer={captureHostPointer}
                    toLocalPoint={toLocalPoint}
                    selectAnnotation={(annotationId) => uiActions.setSelectedStickerAnnotation(annotationId)}
                    setReshapeLine={setReshapeLine}
                    setResizeAnnotation={setResizeAnnotation}
                    beginDirectTransform={beginDirectTransform}
                />

                <StickerAnnotationDraftOverlays
                    draftEffectMode={draftEffectMode()}
                    draftEffectPathData={draftEffectPathData}
                    draftLine={draftLine()}
                    liveErasePreviewVisible={liveErasePreviewVisible()}
                    draftShapeRect={draftShapeRect()}
                    draftShapeMode={draftShapeMode()}
                    draftShapeMeasurement={draftShapeMeasurement()}
                    draftLineMeasurement={draftLineMeasurement()}
                    imageSrc={props.imageSrc}
                    stickerWidth={stickerWidth()}
                    stickerHeight={stickerHeight()}
                />
            </svg>
            <Show when={pendingTextInput()}>
                {(draft) => (
                    <input
                        ref={setPendingTextInputRef}
                        class="absolute z-[20] border bg-transparent px-0 py-0 font-medium outline-none placeholder:text-[rgba(247,252,230,0.55)]"
                        style={{
                            ...pendingTextInputStyle(),
                            "border-color": "color-mix(in srgb, var(--theme-signal) 65%, transparent)",
                            "box-shadow": "inset 0 0 0 1px color-mix(in srgb, var(--theme-signal) 20%, transparent)",
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
            <StickerDesktopColorPickerOverlay
                active={interactionEnabled() && stickerToolSettings.activeTool === "color-picker"}
            />
        </div>
    );
};
