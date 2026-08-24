import { Match, Switch, type Accessor, type Component, type JSX } from "solid-js";

import {
    buildPolygonPoints,
    buildRoundedPolygonPath,
    buildTrianglePoints,
} from "../services/stickerGeometry";
import type {
    StickerAnnotation,
    StickerEffectAnnotation,
    StickerLineAnnotation,
    StickerShapeAnnotation,
    StickerTextAnnotation,
} from "../types/stickerEditing";
import { renderStickerEffectOverlay } from "./StickerEffectOverlay";
import {
    getAnnotationCornerRadius,
    getStrokeDashArray,
    getVisibleFill,
    getVisibleStroke,
} from "./stickerAnnotationModel";
import {
    buildAnnotationRotationTransform,
    renderArrowHeadPath,
    renderArrowShaftPath,
    resolveArrowHead,
} from "./stickerAnnotationRenderGeometry";
import {
    clampFiniteNumber,
    sanitizeCanvasDimension,
    sanitizeEffectBrushSize,
    sanitizeEffectStrength,
    sanitizePolygonSides,
    sanitizeShapeCornerRadius,
    sanitizeStickerPoints,
    sanitizeStickerRect,
    sanitizeStrokeWidth,
} from "./stickerAnnotationNumericSafety";

interface StickerAnnotationItemProps {
    annotation: StickerAnnotation;
    imageSrc?: string;
    stickerWidth: number;
    stickerHeight: number;
    polygonSides: number;
    renderTextAnnotation: (text: Accessor<StickerTextAnnotation>) => JSX.Element;
}

const SHAPE_TYPES = new Set<StickerAnnotation["type"]>([
    "rect",
    "round-rect",
    "ellipse",
    "triangle",
    "polygon",
]);

const renderShapeAnnotation = (shape: StickerShapeAnnotation, polygonSides: number) => {
    const bounds = sanitizeStickerRect(shape);
    if (!bounds) return null;
    const safeShape = { ...shape, ...bounds };
    const strokeWidth = sanitizeStrokeWidth(shape.style.width);
    const cornerRadius = sanitizeShapeCornerRadius(getAnnotationCornerRadius(shape));
    const rotationTransform = buildAnnotationRotationTransform(safeShape);
    const common = {
        stroke: getVisibleStroke(shape.style.color, strokeWidth),
        "stroke-width": strokeWidth,
        fill: getVisibleFill(shape.style.fill),
        "stroke-dasharray": getStrokeDashArray(shape.style.dashPattern),
        opacity: clampFiniteNumber(shape.style.opacity ?? 1, 1, 0, 1),
    };
    if (shape.type === "ellipse") {
        return (
            <g transform={rotationTransform}>
                <ellipse
                    cx={bounds.x + bounds.w / 2}
                    cy={bounds.y + bounds.h / 2}
                    rx={bounds.w / 2}
                    ry={bounds.h / 2}
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
                        buildTrianglePoints(bounds),
                        cornerRadius,
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
                            bounds,
                            sanitizePolygonSides(shape.sides ?? polygonSides),
                        ),
                        cornerRadius,
                    )}
                    {...common}
                />
            </g>
        );
    }
    return (
        <g transform={rotationTransform}>
            <rect
                x={bounds.x}
                y={bounds.y}
                width={bounds.w}
                height={bounds.h}
                rx={cornerRadius}
                ry={cornerRadius}
                {...common}
            />
        </g>
    );
};

const renderEffectAnnotation = (
    effect: StickerEffectAnnotation,
    props: Pick<StickerAnnotationItemProps, "imageSrc" | "stickerWidth" | "stickerHeight">,
) => {
    const bounds = sanitizeStickerRect(effect);
    if (!bounds) return null;
    const storedPoints = sanitizeStickerPoints(effect.points ?? []);
    const effectPoints = storedPoints.length > 0
        ? storedPoints
        : [
              { x: bounds.x, y: bounds.y },
              { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
          ];
    const safeEffect = { ...effect, ...bounds };
    return (
        <g transform={buildAnnotationRotationTransform(safeEffect)}>
            {renderStickerEffectOverlay({
                ...bounds,
                points: effectPoints,
                brushWidth: sanitizeEffectBrushSize(
                    effect.brushWidth || effect.style.width || 20,
                ),
                maskId: `sticker-effect-mask-${effect.id}`,
                effectType: effect.type,
                strength: sanitizeEffectStrength(effect.strength || 8, 8),
                imageSrc: props.imageSrc,
                stickerWidth: sanitizeCanvasDimension(props.stickerWidth),
                stickerHeight: sanitizeCanvasDimension(props.stickerHeight),
            })}
        </g>
    );
};

const renderLineAnnotation = (line: StickerLineAnnotation) => {
    const points = sanitizeStickerPoints(line.points);
    const strokeWidth = sanitizeStrokeWidth(line.style.width || 2);
    const path = renderArrowShaftPath(
        points,
        strokeWidth,
        line.type === "arrow",
    );
    const arrowHead = resolveArrowHead(
        points,
        strokeWidth,
        line.type === "arrow",
    );
    return (
        <g>
            <path
                d={path}
                stroke={line.style.color}
                stroke-width={strokeWidth}
                stroke-linecap={getStrokeDashArray(line.style.dashPattern) ? "butt" : "round"}
                stroke-linejoin="round"
                stroke-dasharray={getStrokeDashArray(line.style.dashPattern)}
                fill="none"
                opacity={clampFiniteNumber(line.style.opacity ?? 1, 1, 0, 1)}
            />
            {arrowHead ? (
                <path
                    d={renderArrowHeadPath(arrowHead)}
                    fill={line.style.color}
                    opacity={clampFiniteNumber(line.style.opacity ?? 1, 1, 0, 1)}
                />
            ) : null}
        </g>
    );
};

// Render exactly one committed annotation. Keyed matches recompute the concrete
// renderer whenever immutable annotation objects are replaced during editing.
export const StickerAnnotationItem: Component<StickerAnnotationItemProps> = (props) => (
    <Switch>
        <Match when={SHAPE_TYPES.has(props.annotation.type) ? props.annotation as StickerShapeAnnotation : undefined} keyed>
            {(shape) => renderShapeAnnotation(shape, props.polygonSides)}
        </Match>
        <Match when={props.annotation.type === "text" || props.annotation.type === "serial" ? props.annotation as StickerTextAnnotation : undefined} keyed>
            {(text) => props.renderTextAnnotation(() => text)}
        </Match>
        <Match when={props.annotation.type === "mosaic" || props.annotation.type === "blur" ? props.annotation as StickerEffectAnnotation : undefined} keyed>
            {(effect) => renderEffectAnnotation(effect, props)}
        </Match>
        <Match when={!SHAPE_TYPES.has(props.annotation.type) && props.annotation.type !== "text" && props.annotation.type !== "serial" && props.annotation.type !== "mosaic" && props.annotation.type !== "blur" ? props.annotation as StickerLineAnnotation : undefined} keyed>
            {renderLineAnnotation}
        </Match>
    </Switch>
);
