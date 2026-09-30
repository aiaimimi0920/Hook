import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const visualOverlaysSource = readFileSync(resolve(process.cwd(), "src/components/UnitVisualOverlays.tsx"), "utf8");
const annotationElementsSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationElements.tsx"),
    "utf8",
);
const annotationViewModelSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationViewModel.tsx"),
    "utf8",
);
const annotationTextControllerSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationTextController.ts"),
    "utf8",
);

describe("Hook sticker annotation layer placement contract", () => {
    it("renders the sticker annotation layer inside the clipped sticker-visual container so bounded shapes cannot visibly spill outside the sticker", () => {
        const visualStart = unitViewSource.indexOf('<div class="sticker-visual"');
        const visualOverlays = unitViewSource.indexOf("<UnitVisualOverlays");
        const selectionBorderStart = unitViewSource.indexOf('<Show when={!isMinified() && !isCleanView()}>');

        expect(visualStart).toBeGreaterThanOrEqual(0);
        expect(visualOverlays).toBeGreaterThan(visualStart);
        expect(selectionBorderStart).toBeGreaterThan(visualOverlays);
        expect(visualOverlaysSource).toContain("<StickerAnnotationLayer");
    });

    it("keeps committed annotation artwork out of pointer hit-testing so SVG text cannot replace the sticker cursor", () => {
        expect(annotationElementsSource).toContain(
            '<g style={{ "pointer-events": "none", cursor: "default" }}>',
        );
        expect(annotationElementsSource).toContain("data-sticker-annotation-id");
        expect(annotationViewModelSource).toContain(
            'style={{ "pointer-events": "none", cursor: "default" }}',
        );
    });

    it("keeps the transparent inline text editor on a visible system cursor while preserving caret editing", () => {
        const annotationLayerSource = readFileSync(
            resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"),
            "utf8",
        );

        expect(annotationLayerSource).toContain('aria-label="输入标注文本"');
        expect(annotationLayerSource).toContain('cursor: "default"');
        expect(annotationTextControllerSource).toContain('"caret-color": draft.color');
    });
});
