import { describe, expect, it } from "vitest";
import { buildSyncedImagePayload, normalizePreviewSrc } from "../../src/services/syncedImagePayload";

describe("synced image payload helpers", () => {
    it("drops previewSrc when it is missing or identical to src", () => {
        expect(normalizePreviewSrc({ data: { src: "data:image/png;base64,abc" } } as any)).toBeUndefined();
        expect(
            normalizePreviewSrc({
                data: {
                    src: "data:image/png;base64,abc",
                    previewSrc: "data:image/png;base64,abc",
                },
            } as any),
        ).toBeUndefined();
    });

    it("keeps previewSrc only when it differs from src", () => {
        expect(
            normalizePreviewSrc({
                data: {
                    src: "data:image/png;base64,abc",
                    previewSrc: "data:image/png;base64,preview",
                },
            } as any),
        ).toBe("data:image/png;base64,preview");
    });

    it("builds sync payloads without duplicate preview data", () => {
        expect(
            buildSyncedImagePayload({
                data: {
                    src: "data:image/png;base64,abc",
                    previewSrc: "data:image/png;base64,abc",
                    rasterizedAnnotationLayerSrc: "layer",
                },
            } as any),
        ).toEqual({
            src: "data:image/png;base64,abc",
            rasterizedAnnotationLayerSrc: "layer",
        });

        expect(
            buildSyncedImagePayload({
                data: {
                    src: "data:image/png;base64,abc",
                    previewSrc: "data:image/png;base64,preview",
                    rasterizedAnnotationLayerSrc: null,
                },
            } as any),
        ).toEqual({
            src: "data:image/png;base64,abc",
            previewSrc: "data:image/png;base64,preview",
            rasterizedAnnotationLayerSrc: null,
        });
    });

    it("uses file-backed image references without syncing giant base64 payloads", () => {
        const payload = buildSyncedImagePayload({
            data: {
                src: "file:///C:/Users/Public/Hook/cache/long.png",
                filePath: "C:/Users/Public/Hook/cache/long.png",
                previewSrc: "data:image/png;base64,preview-should-not-sync",
                rasterizedAnnotationLayerSrc: null,
            },
        } as any);

        expect(payload).toEqual({
            src: "file:///C:/Users/Public/Hook/cache/long.png",
            filePath: "C:/Users/Public/Hook/cache/long.png",
            rasterizedAnnotationLayerSrc: null,
        });
    });
});
