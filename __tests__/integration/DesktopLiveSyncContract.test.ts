import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const syncSource = readFileSync(resolve(process.cwd(), "src/services/syncService.ts"), "utf8");
const payloadHelperSource = readFileSync(resolve(process.cwd(), "src/services/syncedImagePayload.ts"), "utf8");

describe("desktop live workflow synchronization contract", () => {
    it("does not delta-compress image payloads for the hook-live desktop session", () => {
        expect(syncSource).toContain("const forceImageSync = targetWfId === WORKFLOW_ID");
        expect(syncSource).toContain("if (forceImageSync && currentSignature)");
    });

    it("sends current image data in the global hook-live snapshot on every sync cycle", () => {
        const globalSyncStart = syncSource.indexOf("const globalRfNodes = currentUnits.map");
        expect(globalSyncStart).toBeGreaterThanOrEqual(0);

        const globalSyncBlock = syncSource.slice(globalSyncStart, syncSource.indexOf("const globalRfEdges", globalSyncStart));
        expect(globalSyncBlock).toContain("shouldSyncImage(u, WORKFLOW_ID)");
        expect(globalSyncBlock).toContain("await buildSyncedImagePayload(u, { renderBakedPreviewSrc })");
        expect(payloadHelperSource).toContain("src: unit.data?.src");
        expect(payloadHelperSource).toContain("rasterizedAnnotationLayerSrc");
    });

    it("bakes Hook-only sticker edit state before handing the image payload to Loom-facing sync snapshots", () => {
        expect(syncSource).toContain("renderStickerCompositeWithAnnotations");
        expect(syncSource).toContain("buildSyncedImageSignature");
        expect(syncSource).toContain("renderBakedPreviewSrc");
        expect(payloadHelperSource).toContain("requiresBakedStickerSyncImage");
        expect(payloadHelperSource).toContain("src: bakedPreviewSrc");
        expect(payloadHelperSource).toContain("rasterizedAnnotationLayerSrc: null");
    });

    it("resolves the same sticker base image that Hook is currently displaying before baking a Loom/session preview", () => {
        expect(syncSource).toContain("resolveStickerCompositeBaseImageSrc");
        expect(syncSource).toContain("baseImageSrcOverride");
    });
});
