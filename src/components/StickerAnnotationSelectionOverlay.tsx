import { For, Show, type Component, type Setter } from "solid-js";
import { bezierHandles, bezierExtensionHandles, bezierGuidePath, bezierPath } from "../services/stickerBezierGeometry";
import { paintbrushPath } from "../services/stickerPaintbrushGeometry";

import { getAnnotationBounds } from "../services/stickerGeometry";
import { getTextLineMetrics, TEXT_FRAME_PADDING } from "../services/stickerTextGeometry";
import type {
    StickerAnnotation,
    StickerEffectAnnotation,
    StickerLineAnnotation,
    StickerPoint,
    StickerShapeAnnotation,
    StickerTextAnnotation,
    StickerTransformMode,
} from "../types/stickerEditing";
import type { getScaleGizmoHandleRects } from "./stickerAnnotationModel";
import { renderLinePath } from "./stickerAnnotationRenderGeometry";
import type {
    MoveAxisMode,
    ReshapeLineState,
    ResizeAnnotationState,
    TransformInteractionKind,
    TransformPivotMode,
} from "./stickerAnnotationTransformController";

interface BeginTransformOptions {
    axis?: MoveAxisMode;
    pivotMode?: TransformPivotMode;
    selectionIds?: string[];
}

interface StickerAnnotationSelectionOverlayProps {
    setSelectionOverlayRef: (element: SVGGElement) => void;
    selectedAnnotations: StickerAnnotation[];
    selectedAnnotation?: StickerAnnotation;
    selectedGroupBounds?: { x: number; y: number; w: number; h: number };
    selectedAnnotationIds: string[];
    transformMode: StickerTransformMode;
    interactionEnabled: boolean;
    showMoveAxesGizmo: boolean;
    showScaleGizmo: boolean;
    showRotateGizmo: boolean;
    selectedAnnotationCenter: StickerPoint;
    scaleGizmoHandles: ReturnType<typeof getScaleGizmoHandleRects>;
    axisLength: number;
    ringRadius: number;
    captureHostPointer: (pointerId: number) => void;
    toLocalPoint: (event: PointerEvent) => StickerPoint;
    selectAnnotation: (annotationId: string) => void;
    setReshapeLine: Setter<ReshapeLineState | null>;
    setResizeAnnotation: Setter<ResizeAnnotationState | null>;
    beginDirectTransform: (
        event: PointerEvent,
        annotations: StickerAnnotation[],
        kind: TransformInteractionKind,
        options?: BeginTransformOptions,
    ) => boolean;
}

const getBoundsHandlePoints = (bounds: { x: number; y: number; w: number; h: number }) => [
    { handle: "nw" as const, x: bounds.x, y: bounds.y },
    { handle: "ne" as const, x: bounds.x + bounds.w, y: bounds.y },
    { handle: "sw" as const, x: bounds.x, y: bounds.y + bounds.h },
    { handle: "se" as const, x: bounds.x + bounds.w, y: bounds.y + bounds.h },
];

const SelectionBoundsRect: Component<{ bounds: { x: number; y: number; w: number; h: number }; verticalPadding?: number; horizontalPadding?: number }> = (props) => (
    <rect
        x={props.bounds.x - (props.horizontalPadding ?? TEXT_FRAME_PADDING)}
        y={props.bounds.y - (props.verticalPadding ?? TEXT_FRAME_PADDING)}
        width={props.bounds.w + (props.horizontalPadding ?? TEXT_FRAME_PADDING) * 2}
        height={props.bounds.h + (props.verticalPadding ?? TEXT_FRAME_PADDING) * 2}
        rx={8}
        ry={8}
        fill="none"
        stroke="rgba(255,255,255,0.8)"
        stroke-width="1.5"
        stroke-dasharray="6 4"
    />
);

const lineHandlePoints = (annotation: StickerLineAnnotation) => {
    if (annotation.type === "bezier") return [...bezierHandles(annotation.points), ...bezierExtensionHandles(annotation.points)];
    if (annotation.points.length < 2) return [];
    return [
        { handle: "start" as const, point: annotation.points[0] },
        { handle: "end" as const, point: annotation.points[annotation.points.length - 1] },
    ];
};

// Selection visuals stay in one SVG group so imperative move previews can
// translate them together with the selected annotation wrappers.
export const StickerAnnotationSelectionOverlay: Component<StickerAnnotationSelectionOverlayProps> = (props) => (
    <g ref={props.setSelectionOverlayRef} data-sticker-annotation-selection-overlay="true">
        <Show
            when={props.selectedAnnotations.length > 1}
            fallback={
                <Show when={props.selectedAnnotation} keyed>
                    {(value) => {
                        if ("points" in value && Array.isArray(value.points)) {
                            return (
                                <g>
                                    <path
                                        d={value.style.brushTip === "tapered" ? paintbrushPath(value.points, value.style.width, value.style.brushWeights) : value.type === "bezier" ? bezierPath(value.points) : renderLinePath(value.points)}
                                        stroke="rgba(255,255,255,0.9)"
                                        stroke-width={value.style.brushTip === "tapered" ? 2 : (value.style.width || 2) + 6}
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        fill={value.style.brushTip === "tapered" ? "white" : "none"}
                                        opacity={0.25}
                                        style={{ "pointer-events": "none" }}
                                    />
                                    <Show when={value.type === "bezier" && props.transformMode === "select"}>
                                        <path d={bezierGuidePath(value.points)}
                                            fill="none" stroke="var(--theme-signal, #d9ff38)" stroke-width="1" stroke-dasharray="4 3" style={{ "pointer-events": "none" }} />
                                    </Show>
                                    <Show when={props.transformMode === "select" && (value.type === "line" || value.type === "arrow" || value.type === "polyline" || value.type === "bezier")}>
                                        <For each={lineHandlePoints(value as StickerLineAnnotation)}>
                                            {(handle) => (
                                                <g>
                                                <circle
                                                    data-bezier-handle={value.type === "bezier" && !handle.handle.startsWith("extend") ? handle.handle : undefined}
                                                    data-bezier-extend={handle.handle.startsWith("extend") ? handle.handle : undefined}
                                                    aria-label={handle.handle.startsWith("extend") ? (handle.handle === "extend-start" ? "从起点延长曲线" : "从终点延长曲线") : value.type === "bezier" ? `贝塞尔${handle.handle.startsWith("node:") ? "节点" + Number(handle.handle.split(":")[1]) / 3 : handle.handle === "start" ? "起点" : handle.handle === "end" ? "终点" : "控制点" + (handle.handle === "control1" ? 1 : handle.handle === "control2" ? 2 : handle.handle.split(":")[1])}` : undefined}
                                                    cx={handle.point.x}
                                                    cy={handle.point.y}
                                                    r={handle.handle.startsWith("extend") ? 8 : 5}
                                                    fill={handle.handle.startsWith("extend") ? "#0e1218" : handle.handle.startsWith("control") ? "var(--theme-signal, #d9ff38)" : "#ffffff"}
                                                    stroke="rgba(15,23,42,0.95)"
                                                    stroke-width="1.5"
                                                    style={{ cursor: "move" }}
                                                    onPointerDown={(event) => {
                                                        if (event.button !== 0) return;
                                                        event.stopPropagation();
                                                        event.preventDefault();
                                                        props.captureHostPointer(event.pointerId);
                                                        props.selectAnnotation(value.id);
                                                        props.setReshapeLine({
                                                            annotationId: value.id,
                                                            handle: handle.handle,
                                                            current: props.toLocalPoint(event),
                                                            original: value,
                                                        });
                                                    }}
                                                />
                                                <Show when={handle.handle.startsWith("extend")}>
                                                    <path d={`M ${handle.point.x - 4} ${handle.point.y} h8 M ${handle.point.x} ${handle.point.y - 4} v8`}
                                                        stroke="var(--theme-signal, #d9ff38)" stroke-width="1.5" style={{ "pointer-events": "none" }} />
                                                </Show>
                                                </g>
                                            )}
                                        </For>
                                    </Show>
                                </g>
                            );
                        }

                        if ("w" in value && "h" in value) {
                            const bounds = getAnnotationBounds(
                                value as StickerShapeAnnotation | StickerEffectAnnotation,
                            );
                            return (
                                <g>
                                    <SelectionBoundsRect bounds={bounds} />
                                    <Show when={props.transformMode === "select" && !("rotation" in value && !!value.rotation)}>
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
                                                        props.captureHostPointer(event.pointerId);
                                                        props.selectAnnotation(value.id);
                                                        props.setResizeAnnotation({
                                                            annotationId: value.id,
                                                            handle: handle.handle,
                                                            current: props.toLocalPoint(event),
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
                                <SelectionBoundsRect bounds={bounds} verticalPadding={textAnnotation.type === "text" ? 0 : undefined}
                                    horizontalPadding={textAnnotation.type === "text" ? getTextLineMetrics(textAnnotation.fontSize ?? 18, textAnnotation.fontFamily).sidePadding : undefined} />
                                <Show when={props.transformMode === "select"}>
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
                                                    props.beginDirectTransform(event, [value], "scale", { axis: "xy" });
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
                <For each={props.selectedAnnotations}>
                    {(annotation) => (
                        <g>
                            <SelectionBoundsRect bounds={getAnnotationBounds(annotation)} />
                        </g>
                    )}
                </For>
                <Show when={props.selectedGroupBounds} keyed>
                    {(bounds) => (
                        <g>
                            <SelectionBoundsRect bounds={bounds} />
                            <Show when={props.transformMode === "select"}>
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
                                                props.beginDirectTransform(event, props.selectedAnnotations, "scale", {
                                                    axis: "xy",
                                                    selectionIds: props.selectedAnnotationIds,
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

        <Show when={props.interactionEnabled && (props.showMoveAxesGizmo || props.showScaleGizmo || props.showRotateGizmo)}>
            <g style={{ "pointer-events": "none" }}>
                <Show when={props.showMoveAxesGizmo}>
                    <g>
                        <line
                            x1={props.selectedAnnotationCenter.x - props.axisLength}
                            y1={props.selectedAnnotationCenter.y}
                            x2={props.selectedAnnotationCenter.x + props.axisLength}
                            y2={props.selectedAnnotationCenter.y}
                            stroke="rgba(248,113,113,0.9)"
                            stroke-width="2"
                        />
                        <line
                            x1={props.selectedAnnotationCenter.x}
                            y1={props.selectedAnnotationCenter.y - props.axisLength}
                            x2={props.selectedAnnotationCenter.x}
                            y2={props.selectedAnnotationCenter.y + props.axisLength}
                            stroke="rgba(74,222,128,0.9)"
                            stroke-width="2"
                        />
                        <rect
                            x={props.selectedAnnotationCenter.x - 5}
                            y={props.selectedAnnotationCenter.y - 5}
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
                <Show when={props.showScaleGizmo}>
                    <g>
                        <line
                            x1={props.selectedAnnotationCenter.x}
                            y1={props.selectedAnnotationCenter.y}
                            x2={props.selectedAnnotationCenter.x + props.axisLength}
                            y2={props.selectedAnnotationCenter.y}
                            stroke="rgba(248,113,113,0.9)"
                            stroke-width="2"
                        />
                        <line
                            x1={props.selectedAnnotationCenter.x}
                            y1={props.selectedAnnotationCenter.y}
                            x2={props.selectedAnnotationCenter.x}
                            y2={props.selectedAnnotationCenter.y + props.axisLength}
                            stroke="rgba(74,222,128,0.9)"
                            stroke-width="2"
                        />
                        <rect
                            x={props.scaleGizmoHandles.center.x}
                            y={props.scaleGizmoHandles.center.y}
                            width={props.scaleGizmoHandles.center.w}
                            height={props.scaleGizmoHandles.center.h}
                            rx="2"
                            ry="2"
                            fill="rgba(255,255,255,0.92)"
                            stroke="rgba(15,23,42,0.85)"
                            stroke-width="1.25"
                        />
                        <rect
                            x={props.scaleGizmoHandles.x.x}
                            y={props.scaleGizmoHandles.x.y}
                            width={props.scaleGizmoHandles.x.w}
                            height={props.scaleGizmoHandles.x.h}
                            rx="2"
                            ry="2"
                            fill="rgba(248,113,113,0.95)"
                            stroke="rgba(15,23,42,0.85)"
                            stroke-width="1.25"
                        />
                        <rect
                            x={props.scaleGizmoHandles.y.x}
                            y={props.scaleGizmoHandles.y.y}
                            width={props.scaleGizmoHandles.y.w}
                            height={props.scaleGizmoHandles.y.h}
                            rx="2"
                            ry="2"
                            fill="rgba(74,222,128,0.95)"
                            stroke="rgba(15,23,42,0.85)"
                            stroke-width="1.25"
                        />
                    </g>
                </Show>
                <Show when={props.showRotateGizmo}>
                    <circle
                        cx={props.selectedAnnotationCenter.x}
                        cy={props.selectedAnnotationCenter.y}
                        r={props.ringRadius}
                        fill="none"
                        stroke="rgba(96,165,250,0.9)"
                        stroke-width="2"
                        stroke-dasharray="5 3"
                    />
                </Show>
            </g>
        </Show>
    </g>
);
