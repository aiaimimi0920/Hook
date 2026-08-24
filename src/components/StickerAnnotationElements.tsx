import { For, type Accessor, type Component, type JSX } from "solid-js";

import { HIGHLIGHTER_LAYER_OPACITY } from "../services/stickerEditing";
import type {
    ContentEraserStroke,
    StickerAnnotation,
    StickerLineAnnotation,
    StickerTextAnnotation,
} from "../types/stickerEditing";
import { StickerAnnotationItem } from "./StickerAnnotationItem";
import {
    renderArrowShaftPath,
    renderLinePath,
} from "./stickerAnnotationRenderGeometry";

interface StickerAnnotationElementsProps {
    contentEraseStrokes: ContentEraserStroke[];
    highlighterAnnotations: StickerLineAnnotation[];
    annotations: StickerAnnotation[];
    imageSrc?: string;
    stickerWidth: number;
    stickerHeight: number;
    polygonSides: number;
    renderTextAnnotation: (text: Accessor<StickerTextAnnotation>) => JSX.Element;
}

// Preserve the committed SVG z-order: erase traces, one highlighter wash, then
// rank-sorted ordinary annotations. Selection and drafts remain parent-owned.
export const StickerAnnotationElements: Component<StickerAnnotationElementsProps> = (props) => (
    <>
        <For each={props.contentEraseStrokes}>
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
            <For each={props.highlighterAnnotations}>
                {(line) => (
                    <g data-sticker-annotation-id={line.id}>
                        <path
                            d={renderArrowShaftPath(line.points, line.style.width || 2, false)}
                            stroke={line.style.color}
                            stroke-width={line.style.width}
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            fill="none"
                        />
                    </g>
                )}
            </For>
        </g>

        <For each={props.annotations}>
            {(annotation) => (
                <g data-sticker-annotation-id={annotation.id}>
                    <StickerAnnotationItem
                        annotation={annotation}
                        imageSrc={props.imageSrc}
                        stickerWidth={props.stickerWidth}
                        stickerHeight={props.stickerHeight}
                        polygonSides={props.polygonSides}
                        renderTextAnnotation={props.renderTextAnnotation}
                    />
                </g>
            )}
        </For>
    </>
);
