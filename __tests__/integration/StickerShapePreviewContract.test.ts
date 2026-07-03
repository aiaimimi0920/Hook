import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const annotationLayerSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"),
    "utf8",
);
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationModel.ts"), "utf8");
const effectOverlaySource = readFileSync(resolve(process.cwd(), "src/components/StickerEffectOverlay.tsx"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");

describe("Hook sticker shape preview contract", () => {
    it("renders radius-aware rectangle and ellipse previews as their actual shapes during drag", () => {
        expect(annotationLayerSource).toContain("const draftShapeMode = createMemo");
        expect(annotationLayerSource).toContain('draftShapeMode() === "shape-ellipse"');
        expect(annotationLayerSource).toContain("<ellipse");
        expect(annotationLayerSource).toContain("shapeCornerRadius");
        expect(annotationLayerSource).toContain("getShapeCornerRadius");
        expect(annotationLayerSource).toContain("rx={getShapeCornerRadius(draftShapeMode())}");
        expect(annotationLayerSource).toContain("ry={getShapeCornerRadius(draftShapeMode())}");
        expect(annotationLayerSource).toContain("const [shiftPressed, setShiftPressed] = createSignal(false);");
        expect(annotationLayerSource).toContain("const [ctrlPressed, setCtrlPressed] = createSignal(false);");
        expect(annotationLayerSource).toContain('const isSquareConstraintActive = (event?: PointerEvent) =>');
        expect(annotationLayerSource).toContain('!!event?.shiftKey || shiftPressed()');
        expect(annotationLayerSource).toContain('const isRegularShapeStepSnapActive = (mode: DraftShape["mode"], event?: PointerEvent) =>');
        expect(annotationLayerSource).toContain('isRegularShapeMode(mode) && (!!event?.ctrlKey || ctrlPressed())');
        expect(annotationModelSource).toContain('export const isStraightLineMode = (mode: DraftLine["mode"]) =>');
        expect(annotationModelSource).toContain('mode === "line" ||');
        expect(annotationModelSource).toContain('mode === "arrow" ||');
        expect(annotationModelSource).toContain('mode === "brush" ||');
        expect(annotationModelSource).toContain('mode === "highlighter"');
        expect(annotationLayerSource).toContain('const isStraightLineAngleLockActive = (mode: DraftLine["mode"], event?: PointerEvent) =>');
        expect(annotationLayerSource).toContain('const isStraightLineStepSnapActive = (mode: DraftLine["mode"], event?: PointerEvent) =>');
        expect(annotationLayerSource).toContain('const shouldRenderDraftAsStraightSegment = (mode: DraftLine["mode"]) =>');
        expect(annotationLayerSource).toContain('mode === "line" || mode === "arrow" || isStraightLineAngleLockActive(mode, event)');
        expect(annotationLayerSource).toContain('shouldRenderDraftAsStraightSegment(prev.mode)');
        expect(annotationLayerSource).toContain('points: [');
        expect(annotationLayerSource).toContain('isStraightLineStepSnapActive(prev.mode, event)');
        expect(annotationLayerSource).toContain('points: [point],');
        expect(annotationModelSource).toContain('showArrowHead?: boolean;');
        expect(annotationLayerSource).toContain('showArrowHead: activeTool === "arrow" || (activeTool === "line" && stickerToolSettings.lineArrowEnabled),');
        expect(annotationLayerSource).toContain('line.mode === "line" && line.showArrowHead');
        expect(annotationLayerSource).toContain("color: getLineStrokeColor(line.mode),");
        expect(annotationLayerSource).toContain('constrainLinearToolEndpoint(prev.points[0], point, {');
        expect(annotationLayerSource).toContain("buildArrowHeadPolygon");
        expect(annotationLayerSource).toContain("getArrowShaftPoints");
        expect(annotationLayerSource).toContain("const resolveArrowHead = (");
        expect(annotationLayerSource).toContain("const renderArrowShaftPath = (points: StickerPoint[], strokeWidth: number, trimForArrow: boolean) =>");
        expect(annotationLayerSource).toContain("trimForArrow ? getArrowShaftPoints(points, {");
        expect(annotationLayerSource).toContain("const path = renderArrowShaftPath(");
        expect(annotationLayerSource).toContain('line.type === "arrow"');
        expect(annotationLayerSource).toContain("!!draft().showArrowHead,");
        expect(annotationLayerSource).not.toContain("const path = renderLinePath(line.points);");
        expect(annotationLayerSource).toContain("const renderArrowHeadPath = (points: StickerPoint[]) =>");
        expect(annotationLayerSource).not.toContain('stickerToolSettings.mode === "arrow"');
        expect(annotationLayerSource).toContain("force ? buildArrowHeadPolygon");
        expect(annotationLayerSource).toContain("headLength: Math.max(24, strokeWidth * 6)");
        expect(annotationLayerSource).toContain("headWidth: Math.max(16, strokeWidth * 5)");
        expect(annotationLayerSource).toContain("minDistance: 2");
        expect(annotationLayerSource).toContain("d={renderArrowHeadPath(arrowHead)}");
        expect(annotationLayerSource).toContain("draft().showArrowHead");
        expect(annotationLayerSource).not.toContain("marker-end={");
        // Mosaic/blur are freehand brush strokes. The live draft is kept in its own
        // <Show> keyed on the effect MODE (draftEffectMode), so the overlay's
        // expensive <defs> mount once per stroke and only the <path d> updates per
        // pointer move — tracking the cursor as cheaply as the plain brush.
        expect(annotationLayerSource).toContain("draftEffectMode()");
        expect(annotationLayerSource).toContain("<StickerEffectDraftOverlay");
        expect(annotationLayerSource).toContain("renderStickerEffectOverlay({");
        expect(effectOverlaySource).toContain("export const renderStickerEffectOverlay");
        // Mosaic now paints a grid of square cells colored by their ABSOLUTE
        // position in the full sticker, so the grid has no repeating period (the
        // eye never sees the same block of cells tile). The texture is built once
        // per stroke into a sticker-sized PNG and stroked along the brush path as a
        // single non-repeating <image> <pattern>. It never samples the underlying
        // image (zero leakage) and tracks the cursor instantly.
        expect(effectOverlaySource).toContain("<pattern");
        expect(annotationLayerSource).not.toContain("privacyMosaicCssBackground");
        expect(effectOverlaySource).toContain("buildMosaicTextureDataUrl");
        expect(annotationLayerSource).not.toContain('transform: `scale(${snap})`');
        expect(annotationLayerSource).not.toContain("<img");
        expect(annotationLayerSource).not.toContain("buildMosaicPreviewDataUrl");
        expect(annotationLayerSource).not.toContain("requestAnimationFrame");
        expect(annotationLayerSource).not.toContain("const mosaicPreview = previewImage");
        expect(effectOverlaySource).toContain("effectType: \"mosaic\" | \"blur\"");
        expect(annotationLayerSource).toContain('mode === "mosaic" || mode === "blur"');
        expect(annotationLayerSource).toContain("stickerToolSettings.mosaicSize");
        expect(annotationLayerSource).toContain("stickerToolSettings.blurStrength");
        expect(annotationLayerSource).toContain("buildShapeMeasurementBadge");
        expect(annotationLayerSource).toContain("buildLineMeasurementBadge");
        expect(annotationLayerSource).toContain("const renderMeasurementBadge = (badge: Accessor<MeasurementBadge>)");
        expect(annotationLayerSource).toContain("badge().label");
        expect(annotationLayerSource).not.toContain("renderMeasurementBadge(badge())");
        expect(annotationLayerSource).toContain("renderMeasurementBadge(badge)");
        expect(annotationLayerSource).toContain("const draftShapeMeasurement = createMemo");
        expect(annotationLayerSource).toContain("const draftLineMeasurement = createMemo");
        expect(annotationLayerSource).toContain("<Show when={draftShapeMeasurement()}>");
        expect(annotationLayerSource).toContain("<Show when={draftLineMeasurement()}>");
        expect(annotationLayerSource).toContain('window.addEventListener(\"keydown\", handleKeyDown);');
        expect(annotationLayerSource).toContain('window.addEventListener(\"keyup\", handleKeyUp);');
        expect(unitViewSource).toContain("const hasSelectedExistingAnnotations = () =>");
        expect(unitViewSource).toContain("const shouldBlockContainerMouseDown = () =>");
        expect(unitViewSource).toContain('stickerToolSettings.transformMode !== "select"');
        expect(unitViewSource).toContain("const allowContainerMouseDown = () => !shouldBlockContainerMouseDown();");
        expect(unitViewSource).toContain("const showSelectionBorder = () =>");
        expect(unitViewSource).toContain("if (allowContainerMouseDown()) {");
        expect(unitViewSource).toContain("<Show when={showSelectionBorder()}>");
    });
});
