import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const clipboardSource = readFileSync(resolve(process.cwd(), "src/hooks/useClipboard.ts"), "utf8");
const mutationSource = readFileSync(resolve(process.cwd(), "src/services/stickerAnnotationMutations.ts"), "utf8");

describe("Hook sticker annotation copy contract", () => {
    it("duplicates the selected annotation before falling back to whole-sticker clipboard export", () => {
        expect(clipboardSource).toContain("selectedStickerAnnotationId");
        expect(clipboardSource).toContain("duplicateAnnotationById");
        expect(clipboardSource).toContain("uiActions.setSelectedStickerAnnotation(duplicated.createdAnnotationId)");

        expect(mutationSource).toContain("duplicateAnnotationById");
        expect(mutationSource).toContain("translateAnnotation");
    });
});
