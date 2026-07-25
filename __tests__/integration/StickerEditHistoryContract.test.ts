import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const topStripCatalogPath = resolve(process.cwd(), "src/components/stickerTopStripCatalog.tsx");
const topStripCatalogSource = existsSync(topStripCatalogPath) ? readFileSync(topStripCatalogPath, "utf8") : "";
const topStripRenderSource = `${topStripSource}\n${topStripCatalogSource}`;
const shortcutsSource = readFileSync(resolve(process.cwd(), "src/services/shortcuts.ts"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");

describe("Hook sticker edit history contract", () => {
    it("wires undo and redo through both the sticker toolbar and keyboard shortcuts", () => {
        expect(topStripRenderSource).toContain("撤销");
        expect(topStripRenderSource).toContain("重做");
        expect(topStripSource).toContain("historyActionOptions");
        expect(topStripSource).toContain("currentHistoryAction");
        expect(topStripSource).toContain("undoStickerHistory");
        expect(topStripSource).toContain("redoStickerHistory");

        expect(shortcutsSource).toContain("undo-edit");
        expect(shortcutsSource).toContain("redo-edit");
        expect(shortcutsSource).toContain("key: 'z'");
        expect(shortcutsSource).toContain("key: 'y'");

        expect(appSource).toContain("onUndoEdit");
        expect(appSource).toContain("onRedoEdit");
    });

    it("lets select-mode annotations participate in second-pass editing and deletion", () => {
        expect(annotationLayerSource).toContain("selectedStickerAnnotationId");
        expect(annotationLayerSource).toContain("onDblClick");
        expect(annotationLayerSource).toContain("updateTextAnnotationById");
        expect(annotationLayerSource).toContain("resizeBoxAnnotation");
        expect(annotationLayerSource).toContain("setResizeAnnotation");
        expect(annotationLayerSource).toContain("style={{ cursor: `${handle.handle}-resize` }}");
        expect(annotationLayerSource).toContain("moveLineEndpoint");
        expect(annotationLayerSource).toContain("setReshapeLine");
        expect(annotationLayerSource).toContain("lineHandlePoints");

        expect(appSource).toContain("removeAnnotationById");
        expect(appSource).toContain("selectedStickerAnnotationId()");
        expect(appSource).toContain("uiActions.setSelectedStickerAnnotation(null)");
    });
});
