import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(resolve(process.cwd(), "src/features/workspace/components/UnitView.tsx"), "utf8");
const visualOverlaysSource = readFileSync(resolve(process.cwd(), "src/features/workspace/components/UnitVisualOverlays.tsx"), "utf8");
const annotationElementsSource = readFileSync(
    resolve(process.cwd(), "src/features/stickers/components/StickerAnnotationElements.tsx"),
    "utf8",
);
const annotationViewModelSource = readFileSync(
    resolve(process.cwd(), "src/features/stickers/components/stickerAnnotationViewModel.tsx"),
    "utf8",
);
const annotationTextControllerSource = readFileSync(
    resolve(process.cwd(), "src/features/stickers/components/stickerAnnotationTextController.ts"),
    "utf8",
);

describe("Otter sticker annotation layer placement contract", () => {
    it("isolates live drafts from the committed SVG and leaves pointer capture on the host", () => {
        const source = readFileSync(resolve(process.cwd(), "src/features/stickers/components/StickerAnnotationLayer.tsx"), "utf8");
        const committed = source.indexOf("<StickerAnnotationElements");
        const committedEnd = source.indexOf("</svg>", committed);
        const draft = source.indexOf('data-sticker-draft-layer="true"');
        expect(draft).toBeGreaterThan(committedEnd);
        expect(source.slice(draft, source.indexOf("<StickerAnnotationDraftOverlays", draft)))
            .toContain('"pointer-events": "none", transform: "translateZ(0)"');
        expect(source).toContain('<Show when={!!draftLine() || !!draftShape()}>');
    });

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
            resolve(process.cwd(), "src/features/stickers/components/StickerAnnotationLayer.tsx"),
            "utf8",
        );

        expect(annotationLayerSource).toContain('aria-label="输入标注文本"');
        expect(annotationLayerSource).toContain('cursor: "default"');
        expect(annotationTextControllerSource).toContain('"caret-color": draft.color');
    });
});
