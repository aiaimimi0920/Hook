import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe("sticker brush freehand contract", () => {
  it("keeps the paint brush as true freehand input instead of snapping points to the shape step grid", () => {
    const pointerDownSource = readSource("src/components/stickerAnnotationPointerDownController.ts");
    const pointerCommitSource = readSource("src/components/stickerAnnotationPointerCommitController.ts");
    const draftLineMoveBlock = sourceBetween(
      pointerCommitSource,
      "if (options.draftLine()) {",
      "const onPointerUp = async () =>",
    );
    const createLineDraftBlock = sourceBetween(
      pointerDownSource,
      'activeTool === "line"',
      "const handleStickerPointerDown = async",
    );

    expect(draftLineMoveBlock).not.toContain("brushSnapStep");
    expect(draftLineMoveBlock).not.toContain("snapPointToGrid");
    expect(draftLineMoveBlock).not.toContain('currentDraft?.mode === "brush" && stickerToolSettings.shapeSnapStep');
    expect(createLineDraftBlock).not.toContain('activeTool === "brush" && stickerToolSettings.shapeSnapStep');
  });

  it("does not expose the shape snap-step profile setting on brush or highlighter tools", () => {
    const toolSettingsSource = readSource("src/services/toolSettings.ts");

    expect(toolSettingsSource).toContain('brush: ["strokeWidth", "shapeStrokeDashPattern", "brushHighlighterEnabled"]');
    expect(toolSettingsSource).toContain('highlighter: ["strokeWidth", "shapeStrokeDashPattern", "brushHighlighterEnabled"]');
    expect(toolSettingsSource).not.toContain('brush: ["strokeWidth", "shapeSnapStep"');
    expect(toolSettingsSource).not.toContain('highlighter: ["strokeWidth", "shapeSnapStep"');
  });
});
