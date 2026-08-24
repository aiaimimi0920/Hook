import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"),
    "utf8",
);
const pointerRuntimeSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationPointerRuntime.ts"),
    "utf8",
);
const pointerCommitSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationPointerCommitController.ts"),
    "utf8",
);
const elementsSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationElements.tsx"),
    "utf8",
);
const selectionSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationSelectionOverlay.tsx"),
    "utf8",
);

describe("sticker annotation drag performance contract", () => {
    it("moves selected SVG nodes imperatively without rebuilding the annotation array per pointer event", () => {
        expect(pointerRuntimeSource).toContain("const applyImperativeMovePreview = (");
        expect(pointerRuntimeSource).toContain("follower.setAttribute(\"transform\", transform)");
        expect(elementsSource).toContain("data-sticker-annotation-id={annotation.id}");
        expect(elementsSource).toContain("data-sticker-annotation-id={line.id}");
        expect(selectionSource).toContain("data-sticker-annotation-selection-overlay=\"true\"");

        const moveBranch = pointerCommitSource.match(
            /if \(transform\.kind === "move"\) \{([\s\S]*?)return;/,
        )?.[1];
        expect(moveBranch).toContain("applyImperativeMovePreview(transform, point)");
        expect(moveBranch).not.toContain("setTransformInteraction");
        expect(moveBranch).not.toContain("buildTransformPreviewAnnotations");
    });

    it("caches the host bounds for the pointer session and commits only once on release", () => {
        expect(pointerRuntimeSource).toContain(
            "const rect = activePointerRect ?? hostRef?.getBoundingClientRect();",
        );
        expect(pointerRuntimeSource).toContain(
            "activePointerRect ??= target.getBoundingClientRect();",
        );
        expect(pointerRuntimeSource).toContain("if (!rect) return { x: clientX, y: clientY };");
        expect(pointerCommitSource).toContain("transform.kind === \"move\" && imperativeMovePoint");
        expect(pointerCommitSource).toContain("const commit = commitAnnotationElements(");
        expect(pointerCommitSource).toContain("if (pointerReleaseInFlight) return;");
        expect(pointerCommitSource).toContain("await commitPointerRelease();");
        expect(pointerCommitSource).toContain("pointerReleaseInFlight = false;");
    });
});
