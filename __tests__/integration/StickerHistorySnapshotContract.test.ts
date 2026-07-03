import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const historySource = readFileSync(resolve(process.cwd(), "src/services/stickerHistory.ts"), "utf8");

describe("Hook sticker history snapshot contract", () => {
    it("unwraps Solid store proxies before structuredClone so repeated crop snapshots do not crash on proxied imageEditState", () => {
        expect(historySource).toContain('import { unwrap } from "solid-js/store";');
        expect(historySource).toContain("structuredClone(unwrap(snapshot))");
        expect(historySource).toContain("annotationState: structuredClone(unwrap(unit.data.annotationState || createEmptyAnnotationState()))");
        expect(historySource).toContain("imageEditState: structuredClone(unwrap(unit.data.imageEditState || createEmptyImageEditState()))");
    });
});
