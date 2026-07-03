import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const typeSource = readFileSync(resolve(process.cwd(), "src/types/stickerEditing.ts"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/store/uiStore.ts"), "utf8");
const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const toolbarModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerToolbarModel.ts"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationModel.ts"), "utf8");
const shortcutsSource = readFileSync(resolve(process.cwd(), "src/services/shortcuts.ts"), "utf8");
const captureStateSource = readFileSync(resolve(process.cwd(), "src/services/captureState.ts"), "utf8");
const geometrySource = readFileSync(resolve(process.cwd(), "src/services/stickerGeometry.ts"), "utf8");
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
        expect(propertyBarSource).toContain("brushHighlighterEnabled");
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
        expect(topStripSource).toContain('onClick={() => applyTopStripTool("content-eraser")}');
        expect(topStripSource).toContain('onClick={() => applyTopStripTool("crop")}');
        expect(topStripSource).toContain('onClick={() => void runHistoryAction(currentHistoryAction())}');
        expect(topStripSource).toContain('onClick={() => void runRasterizeAction(currentRasterizeScope())}');
    });

    it("routes annotation interactions by editing domain before delegating to transform, create, or sticker handlers", () => {
        expect(annotationLayerSource).toContain("switch (stickerToolSettings.domain)");
        expect(annotationLayerSource).toContain('case "existing"');
        expect(annotationLayerSource).toContain('case "create"');
        expect(annotationLayerSource).toContain('case "sticker"');
        expect(annotationLayerSource).toContain("handleExistingPointerDown");
        expect(annotationLayerSource).toContain("handleCreatePointerDown");
        expect(annotationLayerSource).toContain("handleStickerPointerDown");
        expect(annotationLayerSource).toContain("ctrlKey");
        expect(annotationLayerSource).toContain("altKey");
        expect(annotationLayerSource).toContain("deltaY");
    });

    it("lets blank-surface pointer down bubble back to whole-sticker dragging when select mode has no selected annotations", () => {
        expect(annotationLayerSource).toContain("const shouldPassThroughToStickerDrag =");
        expect(annotationLayerSource).toContain("!hit");
        expect(annotationLayerSource).toContain('transformMode === "select"');
        expect(annotationLayerSource).toContain("currentSelectionIds.length === 0");
        expect(annotationLayerSource).toContain("if (shouldPassThroughToStickerDrag) {");
        expect(annotationLayerSource).toContain("uiActions.setSelectedStickerAnnotations([]);");
        expect(annotationLayerSource).toContain("uiActions.setSelectedStickerAnnotation(null);");
        expect(annotationLayerSource).toContain("return;");
    });

    it("defines group-center and per-node-center rotate/scale helpers for multi-selection transforms", () => {
        expect(geometrySource).toContain("getAnnotationBounds");
        expect(geometrySource).toContain("getAnnotationCenter");
        expect(geometrySource).toContain("getAnnotationGroupCenter");
        expect(geometrySource).toContain("cloneStickerAnnotation");
        expect(geometrySource).toContain("structuredClone(unwrap(annotation))");
        expect(geometrySource).toContain("rotateAnnotationAroundCenter");
        expect(geometrySource).toContain("scaleAnnotationAroundCenter");
        expect(geometrySource).toContain("rotateAnnotationsAroundGroupCenter");
        expect(geometrySource).toContain("rotateAnnotationsAroundOwnCenters");
        expect(geometrySource).toContain("scaleAnnotationsAroundGroupCenter");
        expect(geometrySource).toContain("scaleAnnotationsAroundOwnCenters");
        expect(annotationLayerSource).toContain("baseAnnotations: targetAnnotations.map((annotation) => cloneStickerAnnotation(annotation))");
        expect(annotationLayerSource).not.toContain("baseAnnotations: targetAnnotations.map((annotation) => structuredClone(annotation))");
    });

    it("renders separate move and scale gizmos so move mode keeps free dragging while scale mode exposes dedicated X/Y scale handles", () => {
        expect(annotationLayerSource).toContain("const showMoveAxesGizmo = createMemo(() =>");
        expect(annotationLayerSource).toContain("const showScaleGizmo = createMemo(() =>");
        expect(annotationLayerSource).toContain("resolveMoveGizmoAxisAtPoint");
        expect(annotationLayerSource).toContain("resolveScaleGizmoAxisAtPoint");
        expect(annotationLayerSource).toContain("getScaleGizmoHandleRects");
        expect(annotationLayerSource).not.toContain('transformMode === "scale" ||');

        expect(annotationModelSource).toContain("resolveMoveGizmoAxisAtPoint");
        expect(annotationModelSource).toContain("resolveScaleGizmoAxisAtPoint");
        expect(annotationModelSource).toContain("getScaleGizmoHandleRects");
    });

    it("keeps the selected node dashed frame bound to the live preview annotation instead of a stale snapshot while dragging", () => {
        expect(annotationLayerSource).toContain("<Show when={selectedPreviewAnnotation()} keyed>");
        expect(annotationLayerSource).not.toContain("const value = annotation();");
    });

    it("shows every selected node frame plus a group outer frame for multi-selection scaling", () => {
        expect(annotationLayerSource).toContain("const selectedPreviewAnnotations = createMemo(() =>");
        expect(annotationLayerSource).toContain("const selectedPreviewGroupBounds = createMemo(() =>");
        expect(annotationLayerSource).toContain("selectedPreviewAnnotations().length > 1");
        expect(annotationLayerSource).toContain("<For each={selectedPreviewAnnotations()}>");
        expect(annotationLayerSource).toContain('beginDirectTransform(event, selectedPreviewAnnotations(), "scale", {');
        expect(annotationLayerSource).toContain("selectionIds: selectedAnnotationIds()");
        expect(geometrySource).toContain("export const getAnnotationGroupBounds = (annotations: StickerAnnotation[]): AnnotationBounds =>");
    });
});
