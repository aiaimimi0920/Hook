import type {
    ContentEraserStroke,
    StickerAnnotation,
    StickerAnnotationState,
    StickerEffectAnnotation,
    StickerImageEditState,
    StickerLineAnnotation,
    StickerPoint,
    StickerShapeAnnotation,
    StickerTextAnnotation,
} from "../types/stickerEditing";
import type { Link, StickerEditPropagationState, Unit } from "../types/unit";

export interface StickerEditPropagationPatch {
    unitId: string;
    data: Partial<Unit["data"]>;
}

interface BuildStickerEditPropagationPatchesInput {
    units: readonly Unit[];
    links: readonly Link[];
    sourceUnitId: string;
}

const cloneAnnotationState = (state: StickerAnnotationState): StickerAnnotationState =>
    structuredClone(state);

const samePoint = (a: StickerPoint, b: StickerPoint) =>
    Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001;

const scaleStrokeWidth = (width: number, scaleX: number, scaleY: number) =>
    width * ((Math.abs(scaleX) + Math.abs(scaleY)) / 2);

const scaleStyle = <T extends { width: number; cornerRadius?: number }>(
    style: T,
    scaleX: number,
    scaleY: number,
): T => ({
    ...style,
    width: scaleStrokeWidth(style.width, scaleX, scaleY),
    cornerRadius:
        style.cornerRadius === undefined
            ? undefined
            : scaleStrokeWidth(style.cornerRadius, scaleX, scaleY),
});

const scaleAnnotation = (
    annotation: StickerAnnotation,
    scaleX: number,
    scaleY: number,
    offsetX = 0,
    offsetY = 0,
): StickerAnnotation => {
    if (
        annotation.type === "rect" ||
        annotation.type === "round-rect" ||
        annotation.type === "ellipse" ||
        annotation.type === "triangle" ||
        annotation.type === "polygon"
    ) {
        const shape = annotation as StickerShapeAnnotation;
        return {
            ...shape,
            x: shape.x * scaleX + offsetX,
            y: shape.y * scaleY + offsetY,
            w: shape.w * scaleX,
            h: shape.h * scaleY,
            style: scaleStyle(shape.style, scaleX, scaleY),
        };
    }

    if (annotation.type === "mosaic" || annotation.type === "blur") {
        const effect = annotation as StickerEffectAnnotation;
        return {
            ...effect,
            x: effect.x * scaleX + offsetX,
            y: effect.y * scaleY + offsetY,
            w: effect.w * scaleX,
            h: effect.h * scaleY,
            style: scaleStyle(effect.style, scaleX, scaleY),
            points: effect.points?.map((point) => ({
                x: point.x * scaleX + offsetX,
                y: point.y * scaleY + offsetY,
            })),
            brushWidth:
                effect.brushWidth === undefined
                    ? undefined
                    : scaleStrokeWidth(effect.brushWidth, scaleX, scaleY),
            strength:
                effect.strength === undefined
                    ? undefined
                    : scaleStrokeWidth(effect.strength, scaleX, scaleY),
        };
    }

    if (annotation.type === "text" || annotation.type === "serial") {
        const text = annotation as StickerTextAnnotation;
        return {
            ...text,
            x: text.x * scaleX + offsetX,
            y: text.y * scaleY + offsetY,
            fontSize:
                text.fontSize === undefined
                    ? undefined
                    : scaleStrokeWidth(text.fontSize, scaleX, scaleY),
            style: scaleStyle(text.style, scaleX, scaleY),
        };
    }

    const line = annotation as StickerLineAnnotation;
    return {
        ...line,
        points: line.points.map((point) => ({
            x: point.x * scaleX + offsetX,
            y: point.y * scaleY + offsetY,
        })),
        style: scaleStyle(line.style, scaleX, scaleY),
    };
};

const clipSegmentToFrame = (
    start: StickerPoint,
    end: StickerPoint,
    frame: Pick<Unit, "w" | "h">,
): [StickerPoint, StickerPoint] | undefined => {
    const minX = 0;
    const minY = 0;
    const maxX = frame.w;
    const maxY = frame.h;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let entering = 0;
    let leaving = 1;

    const clip = (p: number, q: number) => {
        if (p === 0) return q >= 0;

        const ratio = q / p;
        if (p < 0) {
            if (ratio > leaving) return false;
            if (ratio > entering) entering = ratio;
            return true;
        }

        if (ratio < entering) return false;
        if (ratio < leaving) leaving = ratio;
        return true;
    };

    if (
        !clip(-dx, start.x - minX) ||
        !clip(dx, maxX - start.x) ||
        !clip(-dy, start.y - minY) ||
        !clip(dy, maxY - start.y)
    ) {
        return undefined;
    }

    return [
        { x: start.x + entering * dx, y: start.y + entering * dy },
        { x: start.x + leaving * dx, y: start.y + leaving * dy },
    ];
};

const clipPointPathToFrame = (
    points: readonly StickerPoint[],
    frame: Pick<Unit, "w" | "h">,
): StickerPoint[][] => {
    if (frame.w <= 0 || frame.h <= 0 || points.length < 2) return [];

    const groups: StickerPoint[][] = [];
    let current: StickerPoint[] = [];

    for (let index = 1; index < points.length; index += 1) {
        const clipped = clipSegmentToFrame(points[index - 1], points[index], frame);
        if (!clipped) {
            if (current.length >= 2) groups.push(current);
            current = [];
            continue;
        }

        const [segmentStart, segmentEnd] = clipped;
        const last = current[current.length - 1];
        if (!last) {
            current = [segmentStart, segmentEnd];
            continue;
        }

        if (!samePoint(last, segmentStart)) {
            if (current.length >= 2) groups.push(current);
            current = [segmentStart, segmentEnd];
            continue;
        }

        if (!samePoint(last, segmentEnd)) {
            current = [...current, segmentEnd];
        }
    }

    if (current.length >= 2) groups.push(current);
    return groups;
};

const withClippedId = (id: string, index: number) => (index === 0 ? id : `${id}:clip${index + 1}`);

const clipBoxToFrame = <T extends StickerShapeAnnotation | StickerEffectAnnotation>(
    annotation: T,
    frame: Pick<Unit, "w" | "h">,
): T | undefined => {
    const x = Math.max(0, annotation.x);
    const y = Math.max(0, annotation.y);
    const right = Math.min(frame.w, annotation.x + annotation.w);
    const bottom = Math.min(frame.h, annotation.y + annotation.h);
    if (right <= x || bottom <= y) return undefined;

    return {
        ...annotation,
        x,
        y,
        w: right - x,
        h: bottom - y,
    };
};

const clipAnnotationToFrame = (
    annotation: StickerAnnotation,
    frame: Pick<Unit, "w" | "h">,
): StickerAnnotation[] => {
    if (
        annotation.type === "rect" ||
        annotation.type === "round-rect" ||
        annotation.type === "ellipse" ||
        annotation.type === "mosaic" ||
        annotation.type === "blur"
    ) {
        const clipped = clipBoxToFrame(annotation, frame);
        return clipped ? [clipped] : [];
    }

    if (annotation.type === "text" || annotation.type === "serial") {
        const text = annotation as StickerTextAnnotation;
        return text.x >= 0 && text.x <= frame.w && text.y >= 0 && text.y <= frame.h
            ? [text]
            : [];
    }

    const line = annotation as StickerLineAnnotation;
    return clipPointPathToFrame(line.points, frame).map((points, index) => ({
        ...line,
        id: withClippedId(line.id, index),
        points,
    }));
};

export const scaleStickerAnnotationState = (
    state: StickerAnnotationState | undefined,
    sourceFrame: Pick<Unit, "w" | "h">,
    targetFrame: Pick<Unit, "w" | "h">,
): StickerAnnotationState | undefined => {
    if (!state) return undefined;

    const scaleX = sourceFrame.w === 0 ? 1 : targetFrame.w / sourceFrame.w;
    const scaleY = sourceFrame.h === 0 ? 1 : targetFrame.h / sourceFrame.h;
    const cloned = cloneAnnotationState(state);

    return {
        serialCounter: cloned.serialCounter,
        elements: cloned.elements.map((annotation) => scaleAnnotation(annotation, scaleX, scaleY)),
    };
};

const getContainedFrameTransform = (
    sourceFrame: Pick<Unit, "w" | "h">,
    targetFrame: Pick<Unit, "w" | "h">,
) => {
    if (sourceFrame.w === 0 || sourceFrame.h === 0) {
        return {
            scale: 1,
            offsetX: (targetFrame.w - sourceFrame.w) / 2,
            offsetY: (targetFrame.h - sourceFrame.h) / 2,
        };
    }

    const scale = Math.min(targetFrame.w / sourceFrame.w, targetFrame.h / sourceFrame.h);
    return {
        scale,
        offsetX: (targetFrame.w - sourceFrame.w * scale) / 2,
        offsetY: (targetFrame.h - sourceFrame.h * scale) / 2,
    };
};

export const mapStickerAnnotationStateToContainedFrame = (
    state: StickerAnnotationState | undefined,
    sourceFrame: Pick<Unit, "w" | "h">,
    targetFrame: Pick<Unit, "w" | "h">,
): StickerAnnotationState | undefined => {
    if (!state) return undefined;

    const transform = getContainedFrameTransform(sourceFrame, targetFrame);
    const cloned = cloneAnnotationState(state);

    return {
        serialCounter: cloned.serialCounter,
        elements: cloned.elements.flatMap((annotation) =>
            clipAnnotationToFrame(annotation, sourceFrame).map((clipped) =>
                scaleAnnotation(
                    clipped,
                    transform.scale,
                    transform.scale,
                    transform.offsetX,
                    transform.offsetY,
                ),
            ),
        ),
    };
};

const clipContentEraserStrokeToFrame = (
    stroke: ContentEraserStroke,
    frame: Pick<Unit, "w" | "h">,
): ContentEraserStroke[] =>
    clipPointPathToFrame(stroke.points, frame).map((points, index) => ({
        ...stroke,
        id: withClippedId(stroke.id, index),
        points,
    }));

const mapContentEraserStrokeToContainedFrame = (
    stroke: ContentEraserStroke,
    scale: number,
    offsetX: number,
    offsetY: number,
): ContentEraserStroke => ({
    ...stroke,
    points: stroke.points.map((point) => ({
        x: point.x * scale + offsetX,
        y: point.y * scale + offsetY,
    })),
    width: stroke.width * Math.abs(scale),
});

export const mapStickerImageEditStateToContainedFrame = (
    state: StickerImageEditState | undefined,
    sourceFrame: Pick<Unit, "w" | "h">,
    targetFrame: Pick<Unit, "w" | "h">,
): StickerImageEditState | undefined => {
    if (!state) return undefined;

    const transform = getContainedFrameTransform(sourceFrame, targetFrame);

    return {
        ...state,
        contentEraseStrokes: state.contentEraseStrokes.flatMap((stroke) =>
            clipContentEraserStrokeToFrame(stroke, sourceFrame).map((clipped) =>
                mapContentEraserStrokeToContainedFrame(
                    clipped,
                    transform.scale,
                    transform.offsetX,
                    transform.offsetY,
                ),
            ),
        ),
        borderWidth:
            state.borderWidth === undefined
                ? undefined
                : state.borderWidth * Math.abs(transform.scale),
        cornerRadius:
            state.cornerRadius === undefined
                ? undefined
                : state.cornerRadius * Math.abs(transform.scale),
    };
};

export const markStickerEditPropagationLocally = (
    previous?: StickerEditPropagationState,
): StickerEditPropagationState => ({
    ...previous,
    acceptUpstream: previous?.acceptUpstream ?? true,
    locallyEdited: true,
    revision: (previous?.revision ?? 0) + 1,
});

const shouldAcceptUpstreamStickerEdit = (unit: Unit) => {
    const propagation = unit.data.stickerEditPropagation;
    return (propagation?.acceptUpstream ?? true) && !propagation?.locallyEdited;
};

export const buildStickerEditPropagationPatches = ({
    units,
    links,
    sourceUnitId,
}: BuildStickerEditPropagationPatchesInput): StickerEditPropagationPatch[] => {
    const workingUnits = new Map(units.map((unit) => [unit.id, structuredClone(unit)] as const));
    const patches: StickerEditPropagationPatch[] = [];
    const visitedEdges = new Set<string>();

    const visit = (fromUnitId: string) => {
        const sourceUnit = workingUnits.get(fromUnitId);
        if (!sourceUnit || sourceUnit.type !== "sticker") return;

        const outgoingLinks = links.filter((link) => link.fromUnitId === fromUnitId);
        outgoingLinks.forEach((link) => {
            const edgeKey = `${link.fromUnitId}->${link.toUnitId}:${link.id}`;
            if (visitedEdges.has(edgeKey)) return;
            visitedEdges.add(edgeKey);

            const targetUnit = workingUnits.get(link.toUnitId);
            if (!targetUnit || targetUnit.type !== "sticker") return;
            if (!shouldAcceptUpstreamStickerEdit(targetUnit)) return;

            const annotationState = mapStickerAnnotationStateToContainedFrame(
                sourceUnit.data.annotationState,
                sourceUnit,
                targetUnit,
            );
            const imageEditState = mapStickerImageEditStateToContainedFrame(
                sourceUnit.data.imageEditState,
                sourceUnit,
                targetUnit,
            );
            const data: Partial<Unit["data"]> = {
                annotationState,
                imageEditState,
                stickerEditPropagation: {
                    ...targetUnit.data.stickerEditPropagation,
                    acceptUpstream: targetUnit.data.stickerEditPropagation?.acceptUpstream ?? true,
                    locallyEdited: false,
                    upstreamSourceUnitId: sourceUnit.id,
                    upstreamSourceRevision: sourceUnit.data.stickerEditPropagation?.revision ?? 0,
                },
            };

            const nextTarget: Unit = {
                ...targetUnit,
                data: {
                    ...targetUnit.data,
                    ...data,
                },
            };
            workingUnits.set(targetUnit.id, nextTarget);
            patches.push({ unitId: targetUnit.id, data });
            visit(targetUnit.id);
        });
    };

    visit(sourceUnitId);
    return patches;
};
