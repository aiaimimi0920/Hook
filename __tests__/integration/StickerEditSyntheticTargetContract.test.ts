import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("sticker edit synthetic target contract", () => {
  it("normalizes overlay-routed pointer targets to a stable sticker interaction root so Ctrl+E tools can keep receiving drag events while the annotation DOM rerenders", () => {
    const appSource = readSource("src/app.tsx");
    const annotationLayerSource = readSource("src/components/StickerAnnotationLayer.tsx");

    expect(appSource).toContain("[data-sticker-interaction-root='true']");
    expect(appSource).toContain("closest?.(\"[data-sticker-interaction-root='true']\")");
    expect(annotationLayerSource).toContain("data-sticker-interaction-root=\"true\"");
  });
});
