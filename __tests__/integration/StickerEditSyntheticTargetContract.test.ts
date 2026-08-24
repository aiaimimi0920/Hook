import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("sticker edit synthetic target contract", () => {
  it("normalizes overlay-routed pointer targets to a stable sticker interaction root so Ctrl+E tools can keep receiving drag events while the annotation DOM rerenders", () => {
    const targetsSource = readSource("src/services/overlaySyntheticTargets.ts");
    const annotationLayerSource = readSource("src/components/StickerAnnotationLayer.tsx");

    expect(targetsSource).toContain("[data-sticker-interaction-root='true']");
    expect(targetsSource).toContain("closest?.(\"[data-sticker-interaction-root='true']\")");
    expect(annotationLayerSource).toContain("data-sticker-interaction-root=\"true\"");
  });
});
