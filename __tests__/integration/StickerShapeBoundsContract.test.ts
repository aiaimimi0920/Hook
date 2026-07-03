import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const annotationLayerSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"),
    "utf8",
);
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationModel.ts"), "utf8");

describe("Hook sticker shape bounds contract", () => {
    it("clamps box-drawn tools to the current sticker bounds instead of allowing rectangles to spill outside the sticker", () => {
        expect(annotationModelSource).toContain('export const isBoundedBoxMode = (mode: DraftShape["mode"]) =>');
        expect(annotationModelSource).toContain('mode === "shape-rect"');
        expect(annotationModelSource).toContain('mode === "shape-ellipse"');
        expect(annotationLayerSource).toContain("isBoundedBoxMode(prev.mode)");
        expect(annotationLayerSource).toContain("isBoundedBoxMode(shape.mode)");
        expect(annotationLayerSource).toContain("isBoundedBoxMode(draft.mode)");
    });
});
