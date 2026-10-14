import { createMemo, Index, Show, type Component } from "solid-js";
import type { StickerPoint, StickerStrokeStyle } from "../types/stickerEditing";
import { freehandOpacity } from "../services/stickerPaintbrushGeometry";
import { createBrushRenderChunks, brushLayerOpacities, opaqueBrushColor } from "../services/stickerBrushRenderChunks";
import { getStrokeDashArray } from "./stickerAnnotationModel";

/** Draft and committed freehand strokes use the same SVG geometry. */
export const FreehandStroke: Component<{ points: StickerPoint[]; strokeStyle: StickerStrokeStyle }> = (props) => {
    const tapered = () => props.strokeStyle.brushTip === "tapered";
    const renderChunks = createBrushRenderChunks();
    const chunks = createMemo(() => tapered() ? renderChunks(props.points, props.strokeStyle) : []);
    const layers = createMemo(() => brushLayerOpacities(props.strokeStyle));
    const path = () => props.points.length === 1 ? `M ${props.points[0].x} ${props.points[0].y} l0.001 0`
            : props.points.map((point, i) => `${i ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
    return <Show when={tapered()} fallback={<path data-freehand-stroke="pencil" d={path()}
        fill={tapered() ? props.strokeStyle.color : "none"} stroke={tapered() ? "none" : props.strokeStyle.color}
        stroke-width={props.strokeStyle.width} stroke-linecap="round" stroke-linejoin="round"
        stroke-dasharray={tapered() ? undefined : getStrokeDashArray(props.strokeStyle.dashPattern)}
        opacity={freehandOpacity(props.strokeStyle.opacity ?? 1)} />}>
        <g data-freehand-stroke="paintbrush">
            <Index each={layers()}>{(opacity, index) =>
                <g opacity={opacity()} fill={opaqueBrushColor(props.strokeStyle.color)}>
                    <Index each={chunks()}>{(chunk) => <path d={chunk().paths[index]} />}</Index>
                </g>
            }</Index>
        </g>
    </Show>;
};
