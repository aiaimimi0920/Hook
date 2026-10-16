import { createMemo, type Component } from "solid-js";
import { brushWeights } from "../services/stickerBrushDynamics";
import { createBrushSmoother } from "../services/stickerBrushSmoothing";
import { freehandOpacity, smoothFreehandPoints } from "../services/stickerPaintbrushGeometry";
import { stickerToolSettings } from "../../workspace/state/uiStore";
import { FreehandStroke } from "./FreehandStroke";
import type { DraftLine } from "./stickerAnnotationModel";
import { sanitizeStickerPoints, sanitizeStrokeWidth } from "./stickerAnnotationNumericSafety";

export const isFreehandDraft = (draft: DraftLine | null) =>
    draft?.mode === "paintbrush" || (draft?.mode === "brush" && !stickerToolSettings.brushHighlighterEnabled);

/** Keep one SVG subtree alive throughout a gesture. The enclosing keyed generic
 * draft renderer otherwise destroys all four brush paths on every pointer move. */
export const FreehandDraftStroke: Component<{ draft: DraftLine | null }> = (props) => {
    const smoothBrush = createBrushSmoother();
    const points = createMemo(() => props.draft?.mode === "paintbrush"
        ? smoothBrush(props.draft.points, stickerToolSettings.brushSmoothing)
        : smoothFreehandPoints(sanitizeStickerPoints(props.draft?.points ?? []), stickerToolSettings.brushSmoothing));
    const weights = createMemo(() => props.draft?.mode === "paintbrush" ? brushWeights(props.draft.points) : undefined);
    return <FreehandStroke points={points()} strokeStyle={{
        color: stickerToolSettings.brushColor,
        width: sanitizeStrokeWidth(stickerToolSettings.strokeWidth),
        opacity: freehandOpacity(stickerToolSettings.brushOpacity),
        brushTip: props.draft?.mode === "paintbrush" ? "tapered" : undefined,
        brushWeights: weights(),
        dashPattern: props.draft?.mode === "brush" ? stickerToolSettings.shapeStrokeDashPattern : undefined,
    }} />;
};
