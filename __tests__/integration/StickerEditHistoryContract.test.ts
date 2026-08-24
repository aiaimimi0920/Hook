import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const topStripCatalogPath = resolve(process.cwd(), "src/components/stickerTopStripCatalog.tsx");
const topStripCatalogSource = existsSync(topStripCatalogPath) ? readFileSync(topStripCatalogPath, "utf8") : "";
const topStripEditActionsSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerTopStripEditActions.tsx"),
    "utf8",
);
const topStripRenderSource = `${topStripEditActionsSource}\n${topStripCatalogSource}`;
const shortcutsSource = readFileSync(resolve(process.cwd(), "src/services/shortcuts.ts"), "utf8");
const appShortcutSource = readFileSync(
    resolve(process.cwd(), "src/hooks/useAppShortcutController.ts"),
    "utf8",
);
const stickerEditingSource = readFileSync(
    resolve(process.cwd(), "src/services/appStickerEditingController.ts"),
    "utf8",
);
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const annotationViewModelSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationViewModel.tsx"),
    "utf8",
);
const transformControllerSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationTransformController.ts"),
    "utf8",
);
const textControllerSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationTextController.ts"),
    "utf8",
);
const selectionOverlaySource = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationSelectionOverlay.tsx"),
    "utf8",
);

describe("Hook sticker edit history contract", () => {
    it("wires undo and redo through both the sticker toolbar and keyboard shortcuts", () => {
        expect(topStripRenderSource).toContain("撤销");
        expect(topStripRenderSource).toContain("重做");
        expect(topStripEditActionsSource).toContain("historyActionOptions");
        expect(topStripSource).toContain("currentHistoryAction");
        expect(topStripSource).toContain("undoStickerHistory");
        expect(topStripSource).toContain("redoStickerHistory");

        expect(shortcutsSource).toContain("undo-edit");
        expect(shortcutsSource).toContain("redo-edit");
        expect(shortcutsSource).toContain("key: 'z'");
        expect(shortcutsSource).toContain("key: 'y'");

        expect(appShortcutSource).toContain("onUndoEdit");
        expect(appShortcutSource).toContain("onRedoEdit");
    });

    it("lets select-mode annotations participate in second-pass editing and deletion", () => {
        expect(annotationViewModelSource).toContain("selectedStickerAnnotationId");
        expect(annotationLayerSource).toContain("onDblClick");
        expect(textControllerSource).toContain("updateTextAnnotationById");
        expect(transformControllerSource).toContain("resizeBoxAnnotation");
        expect(annotationLayerSource).toContain("setResizeAnnotation");
        expect(selectionOverlaySource).toContain("style={{ cursor: `${handle.handle}-resize` }}");
        expect(transformControllerSource).toContain("moveLineEndpoint");
        expect(annotationLayerSource).toContain("setReshapeLine");
        expect(selectionOverlaySource).toContain("lineHandlePoints");

        expect(stickerEditingSource).toContain("removeAnnotationsByIds");
        expect(stickerEditingSource).toContain("selectedStickerAnnotationId()");
        expect(stickerEditingSource).toContain("selectedStickerAnnotationIds");
        expect(stickerEditingSource).toContain("uiActions.setSelectedStickerAnnotation(null)");
    });
});
