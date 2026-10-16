import { describe, expect, it } from "vitest";

import {
    isLikelyLocalFilePath,
    normalizeImageSourceForDisplay,
} from "../../src/platform/tauri/imageSource";

describe("imageSource display normalization", () => {
    it("keeps inline and already-webview-safe image sources unchanged", () => {
        const dataUrl = "data:image/png;base64,abc";
        const blobUrl = "blob:http://localhost/123";
        const assetUrl = "asset://localhost/C:/Users/Public/test.png";

        expect(normalizeImageSourceForDisplay(dataUrl)).toBe(dataUrl);
        expect(normalizeImageSourceForDisplay(blobUrl)).toBe(blobUrl);
        expect(normalizeImageSourceForDisplay(assetUrl)).toBe(assetUrl);
    });

    it("detects Windows file-backed sources and converts them only for display", () => {
        const windowsPath = String.raw`C:\Users\Public\nas_home\AI\GameEditor\Neuro\Otter\images\demo.png`;

        expect(isLikelyLocalFilePath(windowsPath)).toBe(true);
        expect(
            normalizeImageSourceForDisplay(windowsPath, (path) => `asset://localhost/${path}`),
        ).toBe(`asset://localhost/${windowsPath}`);
    });
});
