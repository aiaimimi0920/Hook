import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const syncSource = readFileSync(resolve(process.cwd(), "src/services/syncService.ts"), "utf8");
const payloadHelperSource = readFileSync(resolve(process.cwd(), "src/services/syncedImagePayload.ts"), "utf8");

describe("desktop live workflow synchronization contract", () => {
    it("does not delta-compress image payloads for the hook-live desktop session", () => {
        expect(syncSource).toContain("const forceImageSync = targetWfId === WORKFLOW_ID");
        expect(syncSource).toContain("if (forceImageSync && currentImg)");
    });

    it("sends current image data in the global hook-live snapshot on every sync cycle", () => {
        const globalSyncStart = syncSource.indexOf("const globalRfNodes = currentUnits.map");
        expect(globalSyncStart).toBeGreaterThanOrEqual(0);

        const globalSyncBlock = syncSource.slice(globalSyncStart, syncSource.indexOf("const globalRfEdges", globalSyncStart));
        expect(globalSyncBlock).toContain("shouldSyncImage(u, WORKFLOW_ID)");
        expect(globalSyncBlock).toContain("buildSyncedImagePayload(u)");
        expect(payloadHelperSource).toContain("src: unit.data?.src");
        expect(payloadHelperSource).toContain("rasterizedAnnotationLayerSrc");
    });
});
