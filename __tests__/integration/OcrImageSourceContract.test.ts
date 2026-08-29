import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveUnitImageDataUrl } from "../../src/services/unitImageSource";

const PNG_DATA_URL = "data:image/png;base64,AA==";

describe("OCR image source conversion", () => {
    it("uses the native bounded reader for file-backed capture sources", async () => {
        const readImageFromPath = vi.fn(async () => PNG_DATA_URL);

        const result = await resolveUnitImageDataUrl(
            {
                src: "http://asset.localhost/capture.png",
                filePath: "C:\\Users\\Public\\Hook\\capture.png",
            },
            { readImageFromPath },
        );

        expect(result).toBe(PNG_DATA_URL);
        expect(readImageFromPath).toHaveBeenCalledWith("C:\\Users\\Public\\Hook\\capture.png");
    });

    it("does not copy or fetch an already inline image", async () => {
        const readImageFromPath = vi.fn(async () => PNG_DATA_URL);
        const fetchImage = vi.fn();

        const result = await resolveUnitImageDataUrl(
            { src: PNG_DATA_URL, filePath: "C:\\unused.png" },
            { readImageFromPath, fetchImage },
        );

        expect(result).toBe(PNG_DATA_URL);
        expect(readImageFromPath).not.toHaveBeenCalled();
        expect(fetchImage).not.toHaveBeenCalled();
    });

    it("rejects non-image sources instead of sending them to Loom", async () => {
        await expect(resolveUnitImageDataUrl(
            { src: "C:\\Users\\Public\\Hook\\capture.png" },
            { readImageFromPath: vi.fn(async () => PNG_DATA_URL) },
        )).rejects.toThrow("cannot be converted");
    });

    it("persists a successful OCR result before clipboard access", () => {
        const source = readFileSync(resolve(process.cwd(), "src/hooks/useUnitActions.ts"), "utf8");
        const persistIndex = source.indexOf("graphStore.actions.updateUnitData(unitId");
        const copyIndex = source.indexOf("copyOcrTextToClipboard(fullText)");

        expect(persistIndex).toBeGreaterThanOrEqual(0);
        expect(copyIndex).toBeGreaterThan(persistIndex);
        expect(source).toContain("if (!selectedUnitId) selectionActions.set([unitId]);");
    });

    it("uses the persisted hide flag for OCR overlay visibility", () => {
        const source = readFileSync(resolve(process.cwd(), "src/components/UnitVisualOverlays.tsx"), "utf8");
        expect(source).toContain("!props.unit.data.hideOcr");
    });
});
