import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(process.cwd(), "src/components/CanvasLinks.tsx"),
    "utf8",
);

describe("CanvasLinks reactivity contract", () => {
    it("computes selected-link overlays in tracked memos instead of JSX one-shot IIFEs", () => {
        expect(source).toMatch(/const selectedOverlayLinks = createMemo(?:<[^>]+>)?\(\(\) =>/);
        expect(source).not.toContain("<Show when={selectedStickerId() && !isCleanView()}>\n             {(() => {");
        expect(source).toContain("<For each={selectedOverlayLinks()}>");
    });

    it("computes hover previews in tracked memos instead of JSX one-shot IIFEs", () => {
        expect(source).toMatch(/const hoverPreviewLink = createMemo(?:<[^>]+>)?\(\(\) =>/);
        expect(source).not.toContain(
            "<Show when={hoveringLink().sourceUnitId && hoveringLink().targetUnitId && !isCleanView()}>\n            {(() => {",
        );
        expect(source).toContain("<Show when={hoverPreviewLink()}>");
    });
});
