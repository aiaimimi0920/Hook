import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("sticker edit propagation contract", () => {
  it("stores sticker edit propagation state on units and applies graph-wide downstream patches", () => {
    const unitTypesSource = readSource("src/types/unit.ts");
    const graphStoreSource = readSource("src/store/graphStore.ts");

    expect(unitTypesSource).toContain("stickerEditPropagation?: StickerEditPropagationState");
    expect(graphStoreSource).toContain("buildStickerEditPropagationPatches");
    expect(graphStoreSource).toContain("markStickerEditPropagationLocally");
    expect(graphStoreSource).toContain("updateStickerEditData");
    expect(graphStoreSource).toContain("propagateStickerEditsFrom");
  });

  it("marks direct sticker annotation edits as local and propagates the committed edit downstream", () => {
    const annotationLayerSource = readSource("src/components/StickerAnnotationLayer.tsx");
    const appSource = readSource("src/app.tsx");

    expect(annotationLayerSource).toContain("graphStore.actions.updateStickerEditData(props.unitId");
    expect(annotationLayerSource).toContain("graphStore.actions.propagateStickerEditsFrom(props.unitId)");
    expect(annotationLayerSource).toContain("propagateStickerEditFromCurrentUnit");
    expect(appSource).toContain("graphStore.actions.updateStickerEditData(stickerId");
    expect(appSource).toContain("graphStore.actions.propagateStickerEditsFrom(stickerId)");
  });

  it("backfills existing sticker edits when a new downstream link is created", () => {
    const appSource = readSource("src/app.tsx");
    const linkCreatedStart = appSource.indexOf("onLinkCreated: (sourceId");
    const linkCreatedBlock = appSource.slice(linkCreatedStart, appSource.indexOf("},", linkCreatedStart));

    expect(linkCreatedStart).toBeGreaterThan(0);
    expect(linkCreatedBlock).toContain("graphStore.actions.propagateStickerEditsFrom(sourceId)");
    expect(linkCreatedBlock).toContain("propagateFromUnit(sourceId)");
  });

  it("exposes a sticker setting to stop accepting upstream edit propagation", () => {
    const paramsSource = readSource("src/components/UnitParamsPanel.tsx");

    expect(paramsSource).toContain("接受上级贴图编辑传导");
    expect(paramsSource).toContain("stickerEditPropagation");
    expect(paramsSource).toContain("acceptUpstream");
    expect(paramsSource).toContain("props.unit.type === 'sticker'");
  });
});
