import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const annotationLayerSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"),
    "utf8",
);
const stickerEditingSource = readFileSync(
    resolve(process.cwd(), "src/services/stickerEditing.ts"),
    "utf8",
);
const shortcutsSource = readFileSync(resolve(process.cwd(), "src/hooks/useShortcuts.ts"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("Hook sticker wheel resize contract", () => {
    it("keeps the minified ctrl+wheel guard without focusing the sticker container during wheel opacity edits", () => {
        expect(unitViewSource).toContain("if (e.ctrlKey) {");
        expect(unitViewSource).toContain("if (isMinified()) return;");
        expect(unitViewSource).not.toContain("e.currentTarget.focus();");
        expect(unitViewSource).not.toContain("event.currentTarget.focus();");
        expect(unitViewSource).toContain("queueWheelResize(e);");
        expect(stickerEditingSource).toContain("computeStickerWheelResizeFrame");
        expect(stickerEditingSource).toContain("Math.exp(-deltaY * 0.001)");
        expect(unitViewSource).toContain("props.onOpacityChange(newOp);");
    });

    it("normalizes Windows overlay wheel input to browser WheelEvent direction so wheel-up zooms in and increases opacity", () => {
        expect(rustSource).toContain('"deltaY": -delta_y');
        expect(stickerEditingSource).toContain("Math.exp(-deltaY * 0.001)");
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
        expect(unitViewSource).toContain("computeCroppedStickerImageViewport");
        expect(unitViewSource).toContain("const croppedViewport = getCroppedImageViewport();");
        expect(unitViewSource).toContain('"width": `${croppedViewport.width}px`');
        expect(unitViewSource).toContain('"left": `-${croppedViewport.offsetX}px`');
        expect(stickerEditingSource).toContain("const scaleX = frame.w / cropRect.w;");
        expect(stickerEditingSource).toContain("width: sourceSize.w * scaleX");
        expect(stickerEditingSource).toContain("offsetX: cropRect.x * scaleX");
    });

    it("lets ctrl+wheel bubble back to the sticker frame when ctrl+alt+wheel finds no selected annotations, so a prior alt-wheel opacity tweak cannot black-hole the next scale wheel", () => {
        const wheelStart = annotationLayerSource.indexOf(
            "const onWheel = async (event: WheelEvent) => {",
        );
        const preventIndex = annotationLayerSource.indexOf("event.preventDefault();", wheelStart);
        const noSelectionIndex = annotationLayerSource.indexOf(
            "if (annotationIds.length < 1)",
            wheelStart,
        );
        const noTargetsIndex = annotationLayerSource.indexOf(
            "if (targetAnnotations.length < 1)",
            wheelStart,
        );

        expect(wheelStart).toBeGreaterThanOrEqual(0);
        expect(preventIndex).toBeGreaterThanOrEqual(0);
        expect(noSelectionIndex).toBeGreaterThanOrEqual(0);
        expect(noTargetsIndex).toBeGreaterThanOrEqual(0);
        expect(noSelectionIndex).toBeLessThan(preventIndex);
        expect(noTargetsIndex).toBeLessThan(preventIndex);
        expect(annotationLayerSource.slice(wheelStart, preventIndex)).not.toContain("debugLogEvent");
    });

    it("requires an existing annotation selection before ctrl+alt+wheel can be consumed, so a hovered node cannot hijack the next whole-sticker scale after an alt-wheel opacity tweak", () => {
        const wheelStart = annotationLayerSource.indexOf(
            "const onWheel = async (event: WheelEvent) => {",
        );
        const wheelEnd = annotationLayerSource.indexOf(
            "const draftShapeRect = createMemo(() => {",
            wheelStart,
        );
        const wheelSource = annotationLayerSource.slice(wheelStart, wheelEnd);

        expect(wheelStart).toBeGreaterThanOrEqual(0);
        expect(wheelEnd).toBeGreaterThan(wheelStart);
        expect(wheelSource).toContain("const annotationIds = currentSelectionIds;");
        expect(wheelSource).not.toContain(": [hit.id]");
    });

    it("prevents only the native bare-Alt accelerator default without swallowing Alt from the remaining event chain", () => {
        const suppressStart = shortcutsSource.indexOf(
            "const suppressBareAlt = (e: KeyboardEvent) => {",
        );
        const suppressEnd = shortcutsSource.indexOf("// Global keydown listener", suppressStart);
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
