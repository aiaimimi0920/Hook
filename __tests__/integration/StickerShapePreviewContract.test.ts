import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const annotationLayerSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"),
    "utf8",
);
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationModel.ts"), "utf8");
const effectOverlaySource = readFileSync(resolve(process.cwd(), "src/components/StickerEffectOverlay.tsx"), "utf8");
const annotationItemSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationItem.tsx"), "utf8");
const draftOverlaySource = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationDraftOverlays.tsx"),
    "utf8",
);
const pointerCommitSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationPointerCommitController.ts"),
    "utf8",
);
const pointerDownSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationPointerDownController.ts"),
    "utf8",
);
const annotationLifecycleSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationLifecycleController.ts"),
    "utf8",
);
const annotationStyleSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationStyle.ts"),
    "utf8",
);
const renderGeometrySource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationRenderGeometry.ts"),
    "utf8",
);
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");

describe("Hook sticker shape preview contract", () => {
    it("renders radius-aware rectangle and ellipse previews as their actual shapes during drag", () => {
        expect(annotationLayerSource).toContain("const draftShapeMode = createMemo");
        expect(draftOverlaySource).toContain('props.draftShapeMode === "shape-ellipse"');
        expect(draftOverlaySource).toContain("<ellipse");
        expect(annotationStyleSource).toContain("shapeCornerRadius");
        expect(annotationStyleSource).toContain("export const getShapeCornerRadius");
        expect(draftOverlaySource).toContain("rx={getDraftShapePreviewCornerRadius(props.draftShapeMode)}");
        expect(draftOverlaySource).toContain("ry={getDraftShapePreviewCornerRadius(props.draftShapeMode)}");
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
        expect(pointerCommitSource).toContain('const isStraightLineAngleLockActive = (mode: DraftLine["mode"], event?: PointerEvent) =>');
        expect(pointerCommitSource).toContain('const isStraightLineStepSnapActive = (mode: DraftLine["mode"], event?: PointerEvent) =>');
        expect(pointerCommitSource).toContain('const shouldRenderDraftAsStraightSegment = (mode: DraftLine["mode"]) =>');
        expect(pointerCommitSource).toContain('mode === "line" || mode === "arrow" || isStraightLineAngleLockActive(mode, event)');
        expect(pointerCommitSource).toContain('shouldRenderDraftAsStraightSegment(prev.mode)');
        expect(pointerCommitSource).toContain('points: [');
        expect(pointerCommitSource).toContain('isStraightLineStepSnapActive(prev.mode, event)');
        expect(pointerCommitSource).toContain('points: [lastPoint, point]');
        expect(annotationModelSource).toContain('showArrowHead?: boolean;');
        expect(pointerDownSource).toContain('showArrowHead:');
        expect(pointerDownSource).toContain('activeTool === "arrow" ||');
        expect(pointerDownSource).toContain('(activeTool === "line" && stickerToolSettings.lineArrowEnabled)');
        expect(pointerCommitSource).toContain('line.mode === "line" && line.showArrowHead');
        expect(pointerCommitSource).toContain("color: getLineStrokeColor(line.mode),");
        expect(pointerCommitSource).toContain('constrainLinearToolEndpoint(prev.points[0], point, {');
        expect(renderGeometrySource).toContain("buildArrowHeadPolygon");
        expect(renderGeometrySource).toContain("getArrowShaftPoints");
        expect(renderGeometrySource).toContain("export const resolveArrowHead = (");
        expect(renderGeometrySource).toContain("export const renderArrowShaftPath = (");
        expect(renderGeometrySource).toContain("? getArrowShaftPoints(points, {");
        expect(annotationItemSource).toContain("const path = renderArrowShaftPath(");
        expect(annotationItemSource).toContain('line.type === "arrow"');
        expect(draftOverlaySource).toContain("!!draft.showArrowHead,");
        expect(annotationLayerSource).not.toContain("const path = renderLinePath(line.points);");
        expect(renderGeometrySource).toContain("export const renderArrowHeadPath = (points: StickerPoint[]) =>");
        expect(annotationLayerSource).not.toContain('stickerToolSettings.mode === "arrow"');
        expect(renderGeometrySource).toContain("? buildArrowHeadPolygon(points, {");
        expect(renderGeometrySource).toContain("headLength: Math.max(24, strokeWidth * 6)");
        expect(renderGeometrySource).toContain("headWidth: Math.max(16, strokeWidth * 5)");
        expect(renderGeometrySource).toContain("minDistance: 2");
        expect(annotationItemSource).toContain("d={renderArrowHeadPath(arrowHead)}");
        expect(draftOverlaySource).toContain("draft.showArrowHead");
        expect(annotationLayerSource).not.toContain("marker-end={");
        // Mosaic/blur are freehand brush strokes. The live draft is kept in its own
        // <Show> keyed on the effect MODE (draftEffectMode), so the overlay's
        // expensive <defs> mount once per stroke and only the <path d> updates per
        // pointer move — tracking the cursor as cheaply as the plain brush.
        expect(annotationLayerSource).toContain("draftEffectMode()");
        expect(annotationLayerSource).toContain("<StickerAnnotationDraftOverlays");
        expect(draftOverlaySource).toContain("<StickerEffectDraftOverlay");
        expect(annotationItemSource).toContain("renderStickerEffectOverlay({");
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
        expect(pointerCommitSource).toContain('line.mode === "mosaic" || line.mode === "blur"');
        expect(draftOverlaySource).toContain("stickerToolSettings.mosaicSize");
        expect(draftOverlaySource).toContain("stickerToolSettings.blurStrength");
        expect(annotationLayerSource).toContain("buildShapeMeasurementBadge");
        expect(annotationLayerSource).toContain("buildLineMeasurementBadge");
        expect(draftOverlaySource).toContain("const MeasurementBadgeOverlay");
        expect(draftOverlaySource).toContain("props.badge.label");
        expect(draftOverlaySource).toContain("<MeasurementBadgeOverlay badge={badge} />");
        expect(annotationLayerSource).toContain("const draftShapeMeasurement = createMemo");
        expect(annotationLayerSource).toContain("const draftLineMeasurement = createMemo");
        expect(draftOverlaySource).toContain("<Show when={props.draftShapeMeasurement} keyed>");
        expect(draftOverlaySource).toContain("<Show when={props.draftLineMeasurement} keyed>");
        expect(annotationLifecycleSource).toContain('window.addEventListener(\"keydown\", handleKeyDown);');
        expect(annotationLifecycleSource).toContain('window.addEventListener(\"keyup\", handleKeyUp);');
        expect(unitViewSource).toContain("const hasSelectedExistingAnnotations = () =>");
        expect(unitViewSource).toContain("const shouldBlockContainerMouseDown = () =>");
        expect(unitViewSource).toContain('stickerToolSettings.transformMode !== "select"');
        expect(unitViewSource).toContain("const allowContainerMouseDown = () => !shouldBlockContainerMouseDown();");
        expect(unitViewSource).toContain("const showSelectionBorder = () =>");
        expect(unitViewSource).toContain("if (allowContainerMouseDown()) {");
        expect(unitViewSource).toContain("<Show when={showSelectionBorder()}>");
    });
});
