import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const typeSource = readFileSync(resolve(process.cwd(), "src/types/stickerEditing.ts"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/store/uiStore.ts"), "utf8");
const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const topStripEditActionsSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerTopStripEditActions.tsx"),
    "utf8",
);
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const propertyBarSectionsPath = resolve(process.cwd(), "src/components/stickerTopStripPropertyBarSections.tsx");
const propertyBarSectionsSource = existsSync(propertyBarSectionsPath) ? readFileSync(propertyBarSectionsPath, "utf8") : "";
const propertyBarRenderSource = `${propertyBarSource}\n${propertyBarSectionsSource}`;
const toolbarModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerToolbarModel.ts"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const pointerDownSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationPointerDownController.ts"),
    "utf8",
);
const viewModelSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationViewModel.tsx"),
    "utf8",
);
const wheelControllerSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationWheelController.ts"),
    "utf8",
);
const selectionOverlaySource = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationSelectionOverlay.tsx"),
    "utf8",
);
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationModel.ts"), "utf8");
const shortcutsSource = readFileSync(resolve(process.cwd(), "src/services/shortcuts.ts"), "utf8");
const captureStateSource = readFileSync(resolve(process.cwd(), "src/services/captureState.ts"), "utf8");
const geometryFacadeSource = readFileSync(resolve(process.cwd(), "src/services/stickerGeometry.ts"), "utf8");
const geometryBoundsSource = readFileSync(resolve(process.cwd(), "src/services/stickerAnnotationBounds.ts"), "utf8");
const geometryEditSource = readFileSync(resolve(process.cwd(), "src/services/stickerAnnotationEditGeometry.ts"), "utf8");
const geometryTransformsSource = readFileSync(resolve(process.cwd(), "src/services/stickerAnnotationTransforms.ts"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");

describe("Hook sticker transform modes contract", () => {
    it("splits editing domains, transform modes, and sticker-processing tools in sticker editing state", () => {
        expect(typeSource).toContain('export type StickerEditingDomain =');
        expect(typeSource).toContain('| "existing"');
        expect(typeSource).toContain('| "create"');
        expect(typeSource).toContain('| "sticker"');
        expect(typeSource).toContain('export type StickerCanvasTool =');
        expect(typeSource).toContain('| "idle"');
        expect(typeSource).toContain('| "crop"');
        expect(typeSource).toContain('| "content-eraser"');
        expect(typeSource).toContain('export type StickerTransformMode =');
        expect(typeSource).toContain('| "select"');
        expect(typeSource).toContain('| "move"');
        expect(typeSource).toContain('| "rotate"');
        expect(typeSource).toContain('| "scale"');
        expect(typeSource).toContain('export type StickerCreateTool =');
        expect(typeSource).toContain('domain: StickerEditingDomain');
        expect(typeSource).toContain('activeCanvasTool: StickerCanvasTool');
        expect(typeSource).toContain('transformMode: StickerTransformMode');
        expect(uiStoreSource).toContain("setStickerEditingDomain");
        expect(uiStoreSource).toContain("setStickerCanvasTool");
        expect(uiStoreSource).toContain("setStickerTransformMode");
        expect(uiStoreSource).toContain("setStickerActiveTool");
        expect(uiStoreSource).toContain("patchStickerToolSettings");
    });

    it("adds QWER transform shortcuts without replacing tool shortcuts", () => {
        expect(shortcutsSource).toContain("transform-select");
        expect(shortcutsSource).toContain("transform-move");
        expect(shortcutsSource).toContain("transform-rotate");
        expect(shortcutsSource).toContain("transform-scale");
        expect(shortcutsSource).toContain("transform-select-editing");
        expect(shortcutsSource).toContain("transform-move-editing");
        expect(shortcutsSource).toContain("transform-rotate-editing");
        expect(shortcutsSource).toContain("transform-scale-editing");
        expect(shortcutsSource).toContain("key: 'q'");
        expect(shortcutsSource).toContain("key: 'w'");
        expect(shortcutsSource).toContain("key: 'e'");
        expect(shortcutsSource).toContain("key: 'r'");
        expect(shortcutsSource).toContain("context: 'sticker-editing'");
    });

    it("resolves sticker editing shortcut context from transform mode instead of pretending every tool is a mode", () => {
        expect(captureStateSource).toContain("stickerTransformMode");
        expect(captureStateSource).toContain('input.stickerTransformMode !== "select"');
        expect(captureStateSource).not.toContain("stickerToolMode !== \"select\"");
    });

    it("renders dedicated top-strip slots that light up by editing domain instead of pretending every tool is a transform mode", () => {
        expect(topStripSource).toContain("isModeSelected");
        expect(topStripSource).toContain("isShapeSelected");
        expect(topStripSource).toContain("isBrushSelected");
        expect(topStripSource).toContain("isLabelSelected");
        expect(topStripSource).toContain("isEffectSelected");
        expect(topStripSource).toContain("isEraserSelected");
        expect(topStripSource).toContain("isCropSelected");
        expect(topStripSource).toContain('stickerToolSettings.domain === "existing"');
        expect(topStripSource).toContain('stickerToolSettings.domain === "create"');
        expect(topStripSource).toContain('stickerToolSettings.domain === "sticker"');
        expect(topStripSource).toContain("applyTransformMode");
        expect(topStripSource).toContain("applyCreateTool");
        expect(topStripSource).toContain("applyTopStripTool");
    });

    it("keeps highlighter as a brush property instead of a parallel create-tool button", () => {
        expect(toolbarModelSource).toContain('{ mode: "brush", label: "画笔" }');
        expect(toolbarModelSource).not.toContain('{ mode: "highlighter", label: "荧光" }');
        expect(propertyBarRenderSource).toContain("brushHighlighterEnabled");
    });

    it("re-allows whole-sticker dragging in select mode when existing-node editing has no active annotation selection", () => {
        expect(unitViewSource).toContain("const hasSelectedExistingAnnotations = () =>");
        expect(unitViewSource).toContain("selectedStickerAnnotationIds.length > 0");
        expect(unitViewSource).toContain("selectedStickerAnnotationId() !== null");
        expect(unitViewSource).toContain("const shouldBlockContainerMouseDown = () =>");
        expect(unitViewSource).toContain('stickerToolSettings.transformMode !== "select"');
        expect(unitViewSource).toContain("return hasSelectedExistingAnnotations();");
        expect(unitViewSource).toContain("const allowContainerMouseDown = () => !shouldBlockContainerMouseDown();");
    });

    it("keeps whole-sticker slots separated between crop, eraser, history, and rasterize actions", () => {
        expect(topStripEditActionsSource).toContain('onClick={() => props.onCanvasTool("content-eraser")}');
        expect(topStripEditActionsSource).toContain('onClick={() => props.onCanvasTool("crop")}');
        expect(topStripEditActionsSource).toContain(
            "onClick={() => props.onHistoryAction(props.currentHistoryAction)}",
        );
        expect(topStripEditActionsSource).toContain(
            "onClick={() => props.onRasterize(props.currentRasterizeScope)}",
        );
        expect(topStripSource).toContain("onCanvasTool={applyTopStripTool}");
        expect(topStripSource).toContain("onHistoryAction={(mode) => void runHistoryAction(mode)}");
        expect(topStripSource).toContain("onRasterize={(scope) => void runRasterizeAction(scope)}");
    });

    it("routes annotation interactions by editing domain before delegating to transform, create, or sticker handlers", () => {
        expect(pointerDownSource).toContain("switch (stickerToolSettings.domain)");
        expect(pointerDownSource).toContain('case "existing"');
        expect(pointerDownSource).toContain('case "create"');
        expect(pointerDownSource).toContain('case "sticker"');
        expect(pointerDownSource).toContain("handleExistingPointerDown");
        expect(pointerDownSource).toContain("handleCreatePointerDown");
        expect(pointerDownSource).toContain("handleStickerPointerDown");
        expect(pointerDownSource).toContain('ShortcutManager.isGestureActive(event, "control_quick_rotate")');
        expect(pointerDownSource).toContain('ShortcutManager.isGestureActive(event, "control_quick_move")');
        expect(wheelControllerSource).toContain("deltaY");
    });

    it("lets blank-surface pointer down bubble back to whole-sticker dragging when select mode has no selected annotations", () => {
        expect(pointerDownSource).toContain("const shouldPassThroughToStickerDrag =");
        expect(pointerDownSource).toContain("!hit");
        expect(pointerDownSource).toContain('transformMode === "select"');
        expect(pointerDownSource).toContain("currentSelectionIds.length === 0");
        expect(pointerDownSource).toContain("if (shouldPassThroughToStickerDrag) {");
        expect(pointerDownSource).toContain("uiActions.setSelectedStickerAnnotations([]);");
        expect(pointerDownSource).toContain("uiActions.setSelectedStickerAnnotation(null);");
        expect(pointerDownSource).toContain("return;");
    });

    it("defines group-center and per-node-center rotate/scale helpers for multi-selection transforms", () => {
        expect(geometryFacadeSource).toContain("getAnnotationBounds");
        expect(geometryFacadeSource).toContain("getAnnotationCenter");
        expect(geometryFacadeSource).toContain("getAnnotationGroupCenter");
        expect(geometryFacadeSource).toContain("cloneStickerAnnotation");
        expect(geometryFacadeSource).toContain("rotateAnnotationAroundCenter");
        expect(geometryFacadeSource).toContain("scaleAnnotationAroundCenter");
        expect(geometryFacadeSource).toContain("rotateAnnotationsAroundGroupCenter");
        expect(geometryFacadeSource).toContain("rotateAnnotationsAroundOwnCenters");
        expect(geometryFacadeSource).toContain("scaleAnnotationsAroundGroupCenter");
        expect(geometryFacadeSource).toContain("scaleAnnotationsAroundOwnCenters");
        expect(geometryBoundsSource).toContain("export const getAnnotationBounds");
        expect(geometryBoundsSource).toContain("export const getAnnotationCenter");
        expect(geometryBoundsSource).toContain("export const getAnnotationGroupCenter");
        expect(geometryEditSource).toContain("export const cloneStickerAnnotation");
        expect(geometryEditSource).toContain("structuredClone(unwrap(annotation))");
        expect(geometryTransformsSource).toContain("export const rotateAnnotationAroundCenter");
        expect(geometryTransformsSource).toContain("export const scaleAnnotationAroundCenter");
        expect(geometryTransformsSource).toContain("export const rotateAnnotationsAroundGroupCenter");
        expect(geometryTransformsSource).toContain("export const rotateAnnotationsAroundOwnCenters");
        expect(geometryTransformsSource).toContain("export const scaleAnnotationsAroundGroupCenter");
        expect(geometryTransformsSource).toContain("export const scaleAnnotationsAroundOwnCenters");
        expect(pointerDownSource).toContain("baseAnnotations: annotations.map((annotation) => cloneStickerAnnotation(annotation))");
        expect(pointerDownSource).not.toContain("baseAnnotations: annotations.map((annotation) => structuredClone(annotation))");
    });

    it("renders separate move and scale gizmos so move mode keeps free dragging while scale mode exposes dedicated X/Y scale handles", () => {
        expect(viewModelSource).toContain("const showMoveAxesGizmo = createMemo(() =>");
        expect(viewModelSource).toContain("const showScaleGizmo = createMemo(");
        expect(pointerDownSource).toContain("resolveMoveGizmoAxisAtPoint");
        expect(pointerDownSource).toContain("resolveScaleGizmoAxisAtPoint");
        expect(viewModelSource).toContain("getScaleGizmoHandleRects");
        expect(viewModelSource).not.toContain('transformMode === "scale" ||');

        expect(annotationModelSource).toContain("resolveMoveGizmoAxisAtPoint");
        expect(annotationModelSource).toContain("resolveScaleGizmoAxisAtPoint");
        expect(annotationModelSource).toContain("getScaleGizmoHandleRects");
    });

    it("keeps the selected node dashed frame bound to the live preview annotation instead of a stale snapshot while dragging", () => {
        expect(selectionOverlaySource).toContain("<Show when={props.selectedAnnotation} keyed>");
        expect(annotationLayerSource).not.toContain("const value = annotation();");
    });

    it("shows every selected node frame plus a group outer frame for multi-selection scaling", () => {
        expect(viewModelSource).toContain("const selectedPreviewAnnotations = createMemo(() =>");
        expect(viewModelSource).toContain("const selectedPreviewGroupBounds = createMemo(() =>");
        expect(viewModelSource).toContain("selectedPreviewAnnotations().length > 1");
        expect(selectionOverlaySource).toContain("<For each={props.selectedAnnotations}>");
        expect(selectionOverlaySource).toContain('props.beginDirectTransform(event, props.selectedAnnotations, "scale", {');
        expect(selectionOverlaySource).toContain("selectionIds: props.selectedAnnotationIds");
        expect(geometryBoundsSource).toContain("export const getAnnotationGroupBounds = (annotations: StickerAnnotation[]): AnnotationBounds =>");
    });
});
