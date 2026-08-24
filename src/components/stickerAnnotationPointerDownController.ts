import type { Accessor, Setter } from "solid-js";

import { api } from "../services/api";
import { ShortcutManager } from "../services/shortcuts";
import { stickerToolSettings, uiActions } from "../store/uiStore";
import type {
    StickerAnnotation,
    StickerAnnotationState,
    StickerPoint,
    StickerTextAnnotation,
    StickerTransformMode,
} from "../types/stickerEditing";
import {
    buildSerialAnnotationMetrics,
    nextSerialLabel,
} from "../services/stickerEditing";
import {
    cloneStickerAnnotation,
    findTopmostAnnotationAtPoint,
    getAnnotationGroupCenter,
} from "../services/stickerGeometry";
import {
    isRegularShapeMode,
    resolveMoveGizmoAxisAtPoint,
    resolveScaleGizmoAxisAtPoint,
    type DraftLine,
    type DraftShape,
} from "./stickerAnnotationModel";
import type { createStickerAnnotationEraseController } from "./stickerAnnotationEraseController";
import type { createStickerAnnotationPersistence } from "./stickerAnnotationPersistenceController";
import type { createStickerAnnotationPointerRuntime } from "./stickerAnnotationPointerRuntime";
import type { createStickerAnnotationTextController } from "./stickerAnnotationTextController";
import type {
    ActiveTransformInteraction,
    MoveAxisMode,
    TransformInteractionKind,
    TransformPivotMode,
} from "./stickerAnnotationTransformController";
import {
    sanitizeSerialRadius,
    sanitizeShapeSnapStep,
} from "./stickerAnnotationNumericSafety";

interface GizmoMetrics {
    axisLength: number;
    ringRadius: number;
    hitPadding: number;
    centerSize: number;
    scaleHandleSize: number;
}

interface StickerAnnotationPointerDownOptions {
    interactionEnabled: Accessor<boolean>;
    isPointerReleaseInFlight: Accessor<boolean>;
    annotationState: Accessor<StickerAnnotationState>;
    selectedAnnotationIds: Accessor<string[]>;
    selectedAnnotationCenter: Accessor<StickerPoint>;
    effectiveTransformMode: Accessor<StickerTransformMode>;
    setDraftShape: Setter<DraftShape | null>;
    setDraftLine: Setter<DraftLine | null>;
    setTransformInteraction: Setter<ActiveTransformInteraction | null>;
    isSquareConstraintActive: (event?: PointerEvent) => boolean;
    isRegularShapeStepSnapActive: (mode: DraftShape["mode"], event?: PointerEvent) => boolean;
    gizmo: GizmoMetrics;
    pointerRuntime: ReturnType<typeof createStickerAnnotationPointerRuntime>;
    persistence: Pick<ReturnType<typeof createStickerAnnotationPersistence>, "commitAnnotation">;
    text: Pick<ReturnType<typeof createStickerAnnotationTextController>, "beginPendingTextInput">;
    erase: Pick<
        ReturnType<typeof createStickerAnnotationEraseController>,
        "beginLiveContentErase" | "beginLiveRasterizedAnnotationErase"
    >;
}

// Route pointer-down by interaction domain. This controller starts sessions but
// leaves frame updates and release-time persistence to the commit controller.
export const createStickerAnnotationPointerDownController = (
    options: StickerAnnotationPointerDownOptions,
) => {
    const {
        cacheHostBounds,
        captureHostPointer,
        prepareImperativeMovePreview,
        setImperativeMovePoint,
        toLocalPoint,
    } = options.pointerRuntime;

    const beginDirectTransform = (
        event: PointerEvent,
        annotations: StickerAnnotation[],
        kind: TransformInteractionKind,
        transformOptions?: {
            axis?: MoveAxisMode;
            pivotMode?: TransformPivotMode;
            selectionIds?: string[];
        },
    ) => {
        if (annotations.length < 1) return false;
        const point = toLocalPoint(event);
        const annotationIds = annotations.map((annotation) => annotation.id);
        const selectionIds =
            transformOptions?.selectionIds && transformOptions.selectionIds.length > 0
                ? transformOptions.selectionIds
                : annotationIds;
        uiActions.setSelectedStickerAnnotations(selectionIds);
        captureHostPointer(event.pointerId);
        options.setTransformInteraction({
            kind,
            annotationIds,
            startPoint: point,
            currentPoint: point,
            baseAnnotations: annotations.map((annotation) => cloneStickerAnnotation(annotation)),
            pivotMode:
                transformOptions?.pivotMode ??
                (annotations.length > 1 && event.shiftKey ? "own" : "group"),
            axis: transformOptions?.axis ?? "xy",
            pivot: getAnnotationGroupCenter(annotations),
        });
        if (kind === "move") {
            prepareImperativeMovePreview(annotationIds);
            setImperativeMovePoint(point);
        }
        return true;
    };

    const handleExistingPointerDown = async (
        event: PointerEvent,
        point: StickerPoint,
        hit: StickerAnnotation | undefined,
        currentSelectionIds: string[],
    ) => {
        const transformMode = options.effectiveTransformMode();
        const isHitSelected = !!hit && currentSelectionIds.includes(hit.id);
        const getSelectedTargetAnnotations = () => {
            const ids = hit
                ? isHitSelected && currentSelectionIds.length > 0
                    ? currentSelectionIds
                    : [hit.id]
                : currentSelectionIds;
            if (ids.length > 0) uiActions.setSelectedStickerAnnotations(ids);
            const idSet = new Set(ids);
            return options.annotationState().elements.filter((annotation) => idSet.has(annotation.id));
        };
        const getAnnotationsByIds = (annotationIds: string[]) => {
            const idSet = new Set(annotationIds);
            return options.annotationState().elements.filter((annotation) => idSet.has(annotation.id));
        };
        const resolveGizmoTransform = (): {
            kind: TransformInteractionKind;
            axis: MoveAxisMode;
        } | null => {
            if (currentSelectionIds.length < 1) return null;
            const center = options.selectedAnnotationCenter();
            const pointToCenter = Math.hypot(point.x - center.x, point.y - center.y);
            const moveAxis = resolveMoveGizmoAxisAtPoint(point, center, {
                axisLength: options.gizmo.axisLength,
                hitPadding: options.gizmo.hitPadding,
                centerSize: options.gizmo.centerSize,
            });
            const scaleAxis = resolveScaleGizmoAxisAtPoint(point, center, {
                axisLength: options.gizmo.axisLength,
                hitPadding: options.gizmo.hitPadding,
                centerSize: options.gizmo.centerSize,
                handleSize: options.gizmo.scaleHandleSize,
            });
            const onRing =
                Math.abs(pointToCenter - options.gizmo.ringRadius) <= options.gizmo.hitPadding;

            if (
                transformMode === "rotate" ||
                (transformMode === "select" &&
                    ShortcutManager.isGestureActive(event, "control_quick_rotate"))
            ) {
                return onRing ? { kind: "rotate", axis: "xy" } : null;
            }
            if (transformMode === "scale") {
                return scaleAxis ? { kind: "scale", axis: scaleAxis } : null;
            }
            if (
                transformMode === "move" ||
                (transformMode === "select" &&
                    ShortcutManager.isGestureActive(event, "control_quick_move"))
            ) {
                return moveAxis ? { kind: "move", axis: moveAxis } : null;
            }
            return null;
        };
        const beginTransform = (
            kind: TransformInteractionKind,
            transformOptions?: { annotationIds?: string[]; axis?: MoveAxisMode },
        ) => {
            const targetAnnotations =
                transformOptions?.annotationIds && transformOptions.annotationIds.length > 0
                    ? getAnnotationsByIds(transformOptions.annotationIds)
                    : getSelectedTargetAnnotations();
            if (targetAnnotations.length === 0) return false;
            return beginDirectTransform(event, targetAnnotations, kind, {
                axis: transformOptions?.axis ?? "xy",
                selectionIds: targetAnnotations.map((annotation) => annotation.id),
            });
        };

        const shouldPassThroughToStickerDrag =
            !hit && transformMode === "select" && currentSelectionIds.length === 0;
        if (shouldPassThroughToStickerDrag) {
            uiActions.setSelectedStickerAnnotations([]);
            uiActions.setSelectedStickerAnnotation(null);
            return;
        }

        void api.focusOverlayWindow().catch((error) => {
            console.warn("[Hook] Failed to focus overlay for annotation interaction", error);
        });
        if (
            hit &&
            transformMode === "select" &&
            ShortcutManager.isGestureActive(event, "control_multi_select")
        ) {
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
            })) return;
        }

        if (transformMode === "select") {
            if (ShortcutManager.isGestureActive(event, "control_quick_rotate") && hit) {
                event.stopPropagation();
                event.preventDefault();
                if (beginTransform("rotate")) return;
            }
            if (ShortcutManager.isGestureActive(event, "control_quick_move") && hit) {
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

        if (transformMode === "move" && (hit || currentSelectionIds.length > 0)) {
            event.stopPropagation();
            event.preventDefault();
            if (beginTransform("move")) return;
        }
        if (transformMode === "rotate" && (hit || currentSelectionIds.length > 0)) {
            event.stopPropagation();
            event.preventDefault();
            if (beginTransform("rotate")) return;
        }
        if (transformMode === "scale" && (hit || currentSelectionIds.length > 0)) {
            event.stopPropagation();
            event.preventDefault();
            if (beginTransform("scale")) return;
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
        if (activeTool === "color-picker") return;
        if (activeTool === "text") {
            options.text.beginPendingTextInput(point);
            return;
        }
        if (activeTool === "serial") {
            const label = nextSerialLabel(options.annotationState());
            const serialMetrics = buildSerialAnnotationMetrics(
                sanitizeSerialRadius(stickerToolSettings.serialRadius),
            );
            const annotation: StickerTextAnnotation = {
                id: crypto.randomUUID(),
                type: "serial",
                zIndex: options.annotationState().elements.length + 1,
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
            await options.persistence.commitAnnotation(
                annotation,
                options.annotationState().serialCounter + 1,
            );
            return;
        }
        if (
            activeTool === "shape-rect" ||
            activeTool === "shape-round-rect" ||
            activeTool === "shape-ellipse" ||
            activeTool === "shape-triangle" ||
            activeTool === "shape-polygon"
        ) {
            captureHostPointer(event.pointerId);
            const shouldConstrainSquare =
                isRegularShapeMode(activeTool) &&
                (stickerToolSettings.shapeConstrainSquare || options.isSquareConstraintActive(event));
            const configuredSnapStep = sanitizeShapeSnapStep(stickerToolSettings.shapeSnapStep);
            const effectiveSnapStep = configuredSnapStep > 0
                ? configuredSnapStep
                : options.isRegularShapeStepSnapActive(activeTool, event) ? 10 : undefined;
            options.setDraftShape({
                mode: activeTool,
                start: point,
                current: point,
                constrainSquare: shouldConstrainSquare,
                snapStep: effectiveSnapStep,
            });
            return;
        }
        if (
            activeTool === "line" ||
            activeTool === "polyline" ||
            activeTool === "arrow" ||
            activeTool === "brush" ||
            activeTool === "highlighter" ||
            activeTool === "mosaic" ||
            activeTool === "blur"
        ) {
            captureHostPointer(event.pointerId);
            options.setDraftLine({
                mode: activeTool,
                points: [point],
                showArrowHead:
                    activeTool === "arrow" ||
                    (activeTool === "line" && stickerToolSettings.lineArrowEnabled),
            });
        }
    };

    const handleStickerPointerDown = async (event: PointerEvent, point: StickerPoint) => {
        event.stopPropagation();
        event.preventDefault();
        if (
            stickerToolSettings.activeCanvasTool === "content-eraser" &&
            stickerToolSettings.contentEraserOnlyAnnotations
        ) {
            if (options.erase.beginLiveRasterizedAnnotationErase(point)) {
                captureHostPointer(event.pointerId);
                options.setDraftLine({ mode: "content-eraser", points: [point] });
            }
            return;
        }
        if (stickerToolSettings.activeCanvasTool === "content-eraser") {
            if (options.erase.beginLiveContentErase(point)) {
                captureHostPointer(event.pointerId);
                options.setDraftLine({ mode: "content-eraser", points: [point] });
            }
            return;
        }
        if (stickerToolSettings.activeCanvasTool === "crop") {
            captureHostPointer(event.pointerId);
            options.setDraftShape({
                mode: "crop",
                start: point,
                current: point,
                constrainSquare: false,
            });
        }
    };

    const onPointerDown = async (event: PointerEvent) => {
        if (!options.interactionEnabled() || options.isPointerReleaseInFlight()) return;
        cacheHostBounds();
        const point = toLocalPoint(event);
        const hit = findTopmostAnnotationAtPoint(options.annotationState().elements, point);
        const currentSelectionIds = options.selectedAnnotationIds();
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
        }
    };

    const onDoubleClick = async (event: MouseEvent) => {
        if (!options.interactionEnabled() || options.isPointerReleaseInFlight()) return;
        const point = toLocalPoint(event as PointerEvent);
        const hit = findTopmostAnnotationAtPoint(options.annotationState().elements, point);
        if (!hit || (hit.type !== "text" && hit.type !== "serial")) return;

        event.stopPropagation();
        event.preventDefault();
        options.text.beginPendingTextInput({ x: hit.x, y: hit.y }, hit);
    };

    return { beginDirectTransform, onDoubleClick, onPointerDown };
};
