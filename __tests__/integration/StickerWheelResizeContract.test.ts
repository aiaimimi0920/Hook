import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const unitImageModelSource = readFileSync(resolve(process.cwd(), "src/components/unitImageModel.ts"), "utf8");
const unitImageContentSource = readFileSync(resolve(process.cwd(), "src/components/UnitStickerImageContent.tsx"), "utf8");
const annotationWheelSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationWheelController.ts"),
    "utf8",
);
const stickerEditingFacadeSource = readFileSync(
    resolve(process.cwd(), "src/services/stickerEditing.ts"),
    "utf8",
);
const stickerFrameGeometrySource = readFileSync(
    resolve(process.cwd(), "src/services/stickerFrameGeometry.ts"),
    "utf8",
);
const shortcutsSource = readFileSync(resolve(process.cwd(), "src/hooks/useShortcuts.ts"), "utf8");
const rustSource = readHookLibRustSources();

describe("Hook sticker wheel resize contract", () => {
    it("keeps the minified ctrl+wheel guard without focusing the sticker container during wheel opacity edits", () => {
        expect(unitViewSource).toContain("ShortcutManager.isGestureActive(e, 'sticker_resize')");
        expect(unitViewSource).toContain("if (isMinified()) return;");
        expect(unitViewSource).not.toContain("e.currentTarget.focus();");
        expect(unitViewSource).not.toContain("event.currentTarget.focus();");
        expect(unitViewSource).toContain("queueWheelResize(e);");
        expect(stickerEditingFacadeSource).toContain("computeStickerWheelResizeFrame");
        expect(stickerFrameGeometrySource).toContain("Math.exp(-deltaY * 0.001)");
        expect(unitViewSource).toContain("props.onOpacityChange(newOp);");
    });

    it("normalizes Windows overlay wheel input to browser WheelEvent direction so wheel-up zooms in and increases opacity", () => {
        expect(rustSource).toContain('"deltaY": -delta_y');
        expect(stickerFrameGeometrySource).toContain("Math.exp(-deltaY * 0.001)");
        expect(unitViewSource).toContain("const delta = -e.deltaY * 0.001;");
        expect(rustSource).not.toContain('"deltaY": delta_y');
    });

    it("coalesces ctrl+wheel resize work to one graph update per animation frame without synchronous layout measurement or IPC logging", () => {
        const wheelHandlerStart = unitViewSource.indexOf("onWheel={(e) => {");
        const wheelHandlerEnd = unitViewSource.indexOf("      }}", wheelHandlerStart);
        const wheelHandlerSource = unitViewSource.slice(wheelHandlerStart, wheelHandlerEnd);

        expect(wheelHandlerStart).toBeGreaterThanOrEqual(0);
        expect(wheelHandlerEnd).toBeGreaterThan(wheelHandlerStart);
        expect(unitViewSource).toContain("pendingWheelDeltaY += event.deltaY;");
        expect(unitViewSource).toContain("window.requestAnimationFrame(flushPendingWheelResize)");
        expect(unitViewSource).toContain(
            "props.onResize(computeStickerWheelResizeFrame(currentUnit, pointer, deltaY));",
        );
        expect(wheelHandlerSource).not.toContain("getBoundingClientRect");
        expect(wheelHandlerSource).not.toContain("debugLogEvent");
        expect(unitViewSource).not.toContain("sticker-wheel-trace");
    });

    it("scales cropped image pixels and crop offsets with the current sticker frame instead of only resizing the clipping window", () => {
        expect(unitImageModelSource).toContain("computeCroppedStickerImageViewport(imageContentFrame(), imageEditState())");
        expect(unitImageContentSource).toContain("const viewport = croppedImageViewport;");
        expect(unitImageContentSource).toContain("width: `${viewport.width}px`");
        expect(unitImageContentSource).toContain("left: `-${viewport.offsetX}px`");
        expect(stickerFrameGeometrySource).toContain("const scaleX = frame.w / cropRect.w;");
        expect(stickerFrameGeometrySource).toContain("width: sourceSize.w * scaleX");
        expect(stickerFrameGeometrySource).toContain("offsetX: cropRect.x * scaleX");
    });

    it("lets ctrl+wheel bubble back to the sticker frame when ctrl+alt+wheel finds no selected annotations, so a prior alt-wheel opacity tweak cannot black-hole the next scale wheel", () => {
        const wheelStart = annotationWheelSource.indexOf(
            "const onWheel = async (event: WheelEvent) => {",
        );
        const preventIndex = annotationWheelSource.indexOf("event.preventDefault();", wheelStart);
        const noSelectionIndex = annotationWheelSource.indexOf(
            "if (annotationIds.length < 1)",
            wheelStart,
        );
        const noTargetsIndex = annotationWheelSource.indexOf(
            "if (targetAnnotations.length < 1)",
            wheelStart,
        );

        expect(wheelStart).toBeGreaterThanOrEqual(0);
        expect(preventIndex).toBeGreaterThanOrEqual(0);
        expect(noSelectionIndex).toBeGreaterThanOrEqual(0);
        expect(noTargetsIndex).toBeGreaterThanOrEqual(0);
        expect(noSelectionIndex).toBeLessThan(preventIndex);
        expect(noTargetsIndex).toBeLessThan(preventIndex);
        expect(annotationWheelSource.slice(wheelStart, preventIndex)).not.toContain("debugLogEvent");
    });

    it("requires an existing annotation selection before ctrl+alt+wheel can be consumed, so a hovered node cannot hijack the next whole-sticker scale after an alt-wheel opacity tweak", () => {
        const wheelStart = annotationWheelSource.indexOf(
            "const onWheel = async (event: WheelEvent) => {",
        );
        const wheelEnd = annotationWheelSource.indexOf(
            "dispose: () => {",
            wheelStart,
        );
        const wheelSource = annotationWheelSource.slice(wheelStart, wheelEnd);

        expect(wheelStart).toBeGreaterThanOrEqual(0);
        expect(wheelEnd).toBeGreaterThan(wheelStart);
        expect(wheelSource).toContain("const annotationIds = options.selectedAnnotationIds();");
        expect(wheelSource).not.toContain(": [hit.id]");
        expect(wheelSource).toContain("const task = commitTail.then(async () => {");
        expect(wheelSource).toContain("const currentElements = options.annotationState().elements;");
    });

    it("prevents only the native bare-Alt accelerator default without swallowing Alt from the remaining event chain", () => {
        const suppressStart = shortcutsSource.indexOf(
            "const suppressBareAlt = (e: KeyboardEvent) => {",
        );
        const suppressEnd = shortcutsSource.indexOf("const executeShortcut", suppressStart);
        const suppressSource = shortcutsSource.slice(suppressStart, suppressEnd);

        expect(suppressStart).toBeGreaterThanOrEqual(0);
        expect(suppressEnd).toBeGreaterThan(suppressStart);
        expect(shortcutsSource).toContain("const handleKeyUp = (e: KeyboardEvent) => {");
        expect(shortcutsSource).toContain("const shouldSuppressBareAlt = (e: KeyboardEvent) =>");
        expect(shortcutsSource).toContain("e.key === 'Alt' && !e.ctrlKey && !e.metaKey");
        expect(suppressSource).toContain("e.preventDefault();");
        expect(suppressSource).not.toContain("e.stopPropagation();");
        expect(suppressSource).not.toContain("e.stopImmediatePropagation();");
        expect(shortcutsSource).toContain("window.addEventListener('keydown', handleKeyDown, true);");
        expect(shortcutsSource).toContain("window.addEventListener('keyup', handleKeyUp, true);");
        expect(shortcutsSource).toContain("window.removeEventListener('keydown', handleKeyDown, true);");
        expect(shortcutsSource).toContain("window.removeEventListener('keyup', handleKeyUp, true);");
    });
});
