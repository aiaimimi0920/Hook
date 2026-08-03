import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"),
    "utf8",
);

describe("sticker annotation drag performance contract", () => {
    it("moves selected SVG nodes imperatively without rebuilding the annotation array per pointer event", () => {
        expect(source).toContain("const applyImperativeMovePreview = (");
        expect(source).toContain("follower.setAttribute(\"transform\", transform)");
        expect(source).toContain("data-sticker-annotation-id={annotation.id}");
        expect(source).toContain("data-sticker-annotation-id={line.id}");
        expect(source).toContain("data-sticker-annotation-selection-overlay=\"true\"");

        const moveBranch = source.match(
            /if \(transform\.kind === "move"\) \{([\s\S]*?)return;/,
        )?.[1];
        expect(moveBranch).toContain("applyImperativeMovePreview(transform, point)");
        expect(moveBranch).not.toContain("setTransformInteraction");
        expect(moveBranch).not.toContain("buildTransformPreviewAnnotations");
    });

    it("caches the host bounds for the pointer session and commits only once on release", () => {
        expect(source).toContain(
            "const rect = activePointerRect ?? hostRef!.getBoundingClientRect();",
        );
        expect(source).toContain(
            "activePointerRect ??= hostRef?.getBoundingClientRect() ?? null;",
        );
        expect(source).toContain("transform.kind === \"move\" && imperativeMovePoint");
        expect(source).toContain("const commit = commitAnnotationElements(");
    });
});
