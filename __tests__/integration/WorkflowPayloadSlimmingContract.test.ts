import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const syncServiceSource = readFileSync(resolve(process.cwd(), "src/services/syncService.ts"), "utf8");
const payloadHelperSource = readFileSync(resolve(process.cwd(), "src/services/syncedImagePayload.ts"), "utf8");

describe("Hook workflow payload slimming contract", () => {
    it("drops redundant preview payloads when previewSrc matches src", () => {
        expect(syncServiceSource).toContain("normalizePreviewSrc");
        expect(syncServiceSource).toContain("previewSrc: normalizePreviewSrc(unit) || null");
        expect(syncServiceSource).toContain("buildSyncedImagePayload");
        expect(syncServiceSource).not.toContain("previewSrc: u.data?.previewSrc || u.data?.src");
        expect(payloadHelperSource).toContain("previewSrc === unit.data.src");
        expect(payloadHelperSource).toContain("...(previewSrc ? { previewSrc } : {})");
    });
});
