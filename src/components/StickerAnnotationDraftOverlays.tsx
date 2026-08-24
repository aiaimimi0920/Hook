import { Show, type Accessor, type Component } from "solid-js";

import {
    buildPolygonPoints,
    buildRoundedPolygonPath,
    buildTrianglePoints,
} from "../services/stickerGeometry";
import { HIGHLIGHTER_LAYER_OPACITY } from "../services/stickerEditing";
import type { MeasurementBadge } from "../services/stickerMeasurements";
import { stickerToolSettings } from "../store/uiStore";
import { StickerEffectDraftOverlay } from "./StickerEffectOverlay";
import {
    getStrokeDashArray,
    getVisibleStroke,
    type DraftLine,
    type DraftShape,
} from "./stickerAnnotationModel";
import {
    renderArrowHeadPath,
    renderArrowShaftPath,
    resolveArrowHead,
} from "./stickerAnnotationRenderGeometry";
import {
    sanitizeContentEraserSize,
    sanitizeEffectBrushSize,
    sanitizeEffectStrength,
    sanitizePolygonSides,
    sanitizeStickerPoints,
    sanitizeStrokeWidth,
} from "./stickerAnnotationNumericSafety";
import {
    getDraftShapePreviewCornerRadius,
    getDraftShapePreviewDashArray,
    getDraftShapePreviewFill,
    getDraftShapePreviewStrokeWidth,
    getLineStrokeColor,
    getShapeCornerRadius,
    getShapeStrokeColorForMode,
    isHighlighterLineMode,
} from "./stickerAnnotationStyle";

interface DraftRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface StickerAnnotationDraftOverlaysProps {
    draftEffectMode: "mosaic" | "blur" | null;
    draftEffectPathData: Accessor<string>;
    draftLine: DraftLine | null;
    liveErasePreviewVisible: boolean;
    draftShapeRect: DraftRect | null;
    draftShapeMode?: DraftShape["mode"];
    draftShapeMeasurement: MeasurementBadge | null;
    draftLineMeasurement: MeasurementBadge | null;
    imageSrc?: string;
    stickerWidth: number;
    stickerHeight: number;
}

const MeasurementBadgeOverlay: Component<{ badge: MeasurementBadge }> = (props) => (
    <g style={{ "pointer-events": "none" }}>
        <rect
            x={props.badge.x}
            y={props.badge.y}
            width={props.badge.width}
            height={props.badge.height}
            rx={6}
            ry={6}
            fill="rgba(15,23,42,0.9)"
            stroke="rgba(255,255,255,0.35)"
            stroke-width={1}
        />
        <text
            x={props.badge.textX}
            y={props.badge.textY}
            fill="#ffffff"
            font-size="11"
            font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
            font-weight={700}
        >
            {props.badge.label}
        </text>
    </g>
);

// Drafts render after committed annotations and selection, preserving the live
// tool preview as the topmost SVG layer without persisting pointer-move state.
export const StickerAnnotationDraftOverlays: Component<StickerAnnotationDraftOverlaysProps> = (props) => (
    <>
        {/* Key the effect overlay by mode so its expensive defs mount once per stroke. */}
        <Show when={props.draftEffectMode} keyed>
            {(mode) => (
                <StickerEffectDraftOverlay
                    effectType={mode}
                    pathData={props.draftEffectPathData}
                    brushWidth={sanitizeEffectBrushSize(stickerToolSettings.effectBrushSize)}
                    strength={
                        mode === "mosaic"
                            ? sanitizeEffectStrength(stickerToolSettings.mosaicSize, 12)
                            : sanitizeEffectStrength(stickerToolSettings.blurStrength, 8)
                    }
                    imageSrc={props.imageSrc}
                    stickerWidth={props.stickerWidth}
                    stickerHeight={props.stickerHeight}
                />
            )}
        </Show>

        <Show when={props.draftEffectMode ? null : props.draftLine} keyed>
            {(draft) => {
                const points = sanitizeStickerPoints(draft.points);
                const strokeColor = draft.mode === "content-eraser"
                    ? "rgba(255,255,255,0.85)"
                    : getLineStrokeColor(draft.mode);
                const strokeWidth = draft.mode === "content-eraser"
                    ? sanitizeContentEraserSize(stickerToolSettings.contentEraserSize)
                    : sanitizeStrokeWidth(stickerToolSettings.strokeWidth);
                const hidesLiveEraseDraft =
                    draft.mode === "content-eraser" && props.liveErasePreviewVisible;
                const previewDashArray =
                    draft.mode === "line" ||
                    draft.mode === "arrow" ||
                    (draft.mode === "brush" && !stickerToolSettings.brushHighlighterEnabled)
                        ? getStrokeDashArray(stickerToolSettings.shapeStrokeDashPattern)
                        : undefined;
                const isHighlighterDraft = isHighlighterLineMode(draft.mode);
                const arrowHead = draft.showArrowHead
                    ? resolveArrowHead(points, strokeWidth, true)
                    : null;
                return (
                    <g>
                        <Show when={!hidesLiveEraseDraft}>
                            <Show
                                when={isHighlighterDraft}
                                fallback={
                                    <path
                                        d={renderArrowShaftPath(
                                            points,
                                            strokeWidth,
                                            !!draft.showArrowHead,
                                        )}
                                        stroke={strokeColor}
                                        stroke-width={strokeWidth}
                                        stroke-linecap={previewDashArray ? "butt" : "round"}
                                        stroke-linejoin="round"
                                        stroke-dasharray={previewDashArray}
                                        fill="none"
                                        opacity={1}
                                    />
                                }
                            >
                                <g opacity={HIGHLIGHTER_LAYER_OPACITY}>
                                    <path
                                        d={renderArrowShaftPath(points, strokeWidth, false)}
                                        stroke={strokeColor}
                                        stroke-width={strokeWidth}
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        fill="none"
                                    />
                                </g>
                            </Show>
                        </Show>
                        <Show when={arrowHead} keyed>
                            {(points) => (
                                <path
                                    d={renderArrowHeadPath(points)}
                                    fill={strokeColor}
                                    opacity={isHighlighterDraft ? 0.35 : 1}
                                />
                            )}
                        </Show>
                    </g>
                );
            }}
        </Show>

        <Show when={props.draftShapeRect} keyed>
            {(draftRect) => (
                <Show
                    when={props.draftShapeMode === "shape-ellipse"}
                    fallback={
                        <Show
                            when={props.draftShapeMode === "shape-triangle"}
                            fallback={
                                <Show
                                    when={props.draftShapeMode === "shape-polygon"}
                                    fallback={
                                        <rect
                                            x={draftRect.x}
                                            y={draftRect.y}
                                            width={draftRect.w}
                                            height={draftRect.h}
                                            rx={getDraftShapePreviewCornerRadius(props.draftShapeMode)}
                                            ry={getDraftShapePreviewCornerRadius(props.draftShapeMode)}
                                            fill={getDraftShapePreviewFill(props.draftShapeMode)}
                                            stroke={getVisibleStroke(
                                                getShapeStrokeColorForMode(props.draftShapeMode ?? "shape-rect"),
                                                getDraftShapePreviewStrokeWidth(props.draftShapeMode),
                                            )}
                                            stroke-width={getDraftShapePreviewStrokeWidth(props.draftShapeMode)}
                                            stroke-dasharray={getDraftShapePreviewDashArray(props.draftShapeMode)}
                                        />
                                    }
                                >
                                    <path
                                        d={buildRoundedPolygonPath(
                                            buildPolygonPoints(
                                                draftRect,
                                                sanitizePolygonSides(stickerToolSettings.polygonSides),
                                            ),
                                            getShapeCornerRadius(props.draftShapeMode),
                                        )}
                                        fill={getDraftShapePreviewFill(props.draftShapeMode)}
                                        stroke={getVisibleStroke(
                                            getShapeStrokeColorForMode("shape-polygon"),
                                            sanitizeStrokeWidth(stickerToolSettings.strokeWidth),
                                        )}
                                        stroke-width={sanitizeStrokeWidth(stickerToolSettings.strokeWidth)}
                                        stroke-dasharray={getDraftShapePreviewDashArray(props.draftShapeMode)}
                                    />
                                </Show>
                            }
                        >
                            <path
                                d={buildRoundedPolygonPath(
                                    buildTrianglePoints(draftRect),
                                    getShapeCornerRadius(props.draftShapeMode),
                                )}
                                fill={getDraftShapePreviewFill(props.draftShapeMode)}
                                stroke={getVisibleStroke(
                                    getShapeStrokeColorForMode("shape-triangle"),
                                    sanitizeStrokeWidth(stickerToolSettings.strokeWidth),
                                )}
                                stroke-width={sanitizeStrokeWidth(stickerToolSettings.strokeWidth)}
                                stroke-dasharray={getDraftShapePreviewDashArray(props.draftShapeMode)}
                            />
                        </Show>
                    }
                >
                    <ellipse
                        cx={draftRect.x + draftRect.w / 2}
                        cy={draftRect.y + draftRect.h / 2}
                        rx={draftRect.w / 2}
                        ry={draftRect.h / 2}
                        fill={getDraftShapePreviewFill(props.draftShapeMode)}
                        stroke={getVisibleStroke(
                            getShapeStrokeColorForMode("shape-ellipse"),
                            sanitizeStrokeWidth(stickerToolSettings.strokeWidth),
                        )}
                        stroke-width={sanitizeStrokeWidth(stickerToolSettings.strokeWidth)}
                        stroke-dasharray={getDraftShapePreviewDashArray(props.draftShapeMode)}
                    />
                </Show>
            )}
        </Show>

        <Show when={props.draftShapeMeasurement} keyed>
            {(badge) => <MeasurementBadgeOverlay badge={badge} />}
        </Show>
        <Show when={props.draftLineMeasurement} keyed>
            {(badge) => <MeasurementBadgeOverlay badge={badge} />}
        </Show>
    </>
);
