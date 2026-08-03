import { describe, expect, it, vi } from "vitest";
import {
    buildSyncedImagePayload,
    buildSyncedImageSignature,
    normalizePreviewSrc,
    requiresBakedStickerSyncImage,
} from "../../src/services/syncedImagePayload";

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

    it("builds sync payloads without duplicate preview data", async () => {
        await expect(
            buildSyncedImagePayload({
                data: {
                    src: "data:image/png;base64,abc",
                    previewSrc: "data:image/png;base64,abc",
                    rasterizedAnnotationLayerSrc: "layer",
                },
            } as any),
        ).resolves.toEqual({
            src: "data:image/png;base64,abc",
            rasterizedAnnotationLayerSrc: "layer",
        });

        await expect(
            buildSyncedImagePayload({
                data: {
                    src: "data:image/png;base64,abc",
                    previewSrc: "data:image/png;base64,preview",
                    rasterizedAnnotationLayerSrc: null,
                },
            } as any),
        ).resolves.toEqual({
            src: "data:image/png;base64,abc",
            previewSrc: "data:image/png;base64,preview",
            rasterizedAnnotationLayerSrc: null,
        });
    });

    it("uses file-backed image references without syncing giant base64 payloads", async () => {
        const payload = await buildSyncedImagePayload({
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

    it("marks stickers with Hook-only edit state as requiring a baked sync image", () => {
        expect(
            requiresBakedStickerSyncImage({
                type: "sticker",
                w: 160,
                h: 90,
                data: {
                    src: "data:image/png;base64,base",
                    annotationState: {
                        elements: [
                            {
                                id: "annotation-1",
                                type: "line",
                                zIndex: 1,
                                points: [
                                    { x: 10, y: 10 },
                                    { x: 40, y: 30 },
                                ],
                                style: {
                                    color: "#ffffff",
                                    width: 2,
                                },
                            },
                        ],
                        serialCounter: 1,
                    },
                },
            } as any),
        ).toBe(true);

        expect(
            requiresBakedStickerSyncImage({
                type: "sticker",
                w: 160,
                h: 90,
                data: {
                    src: "data:image/png;base64,base",
                    imageEditState: {
                        contentEraseStrokes: [],
                        cropRect: { x: 5, y: 6, w: 70, h: 50 },
                    },
                },
            } as any),
        ).toBe(true);
    });

    it("uses the baked Hook-side composite as the sync image when Loom cannot reconstruct the visual result", async () => {
        const renderBakedPreviewSrc = vi
            .fn()
            .mockResolvedValue("data:image/png;base64,baked-sync-preview");

        const payload = await buildSyncedImagePayload(
            {
                type: "sticker",
                w: 160,
                h: 90,
                data: {
                    src: "file:///C:/Users/Public/Hook/cache/base.png",
                    filePath: "C:/Users/Public/Hook/cache/base.png",
                    rasterizedAnnotationLayerSrc: "data:image/png;base64,LAYER",
                    annotationState: {
                        elements: [
                            {
                                id: "annotation-1",
                                type: "line",
                                zIndex: 1,
                                points: [
                                    { x: 10, y: 10 },
                                    { x: 40, y: 30 },
                                ],
                                style: {
                                    color: "#ffffff",
                                    width: 2,
                                },
                            },
                        ],
                        serialCounter: 1,
                    },
                },
            } as any,
            { renderBakedPreviewSrc },
        );

        expect(renderBakedPreviewSrc).toHaveBeenCalledTimes(1);
        expect(payload).toEqual({
            src: "data:image/png;base64,baked-sync-preview",
            rasterizedAnnotationLayerSrc: null,
        });
    });

    it("includes vector and edit state in the sync signature so Hook can re-render Loom payloads when visuals change", () => {
        const baseUnit = {
            type: "sticker",
            w: 160,
            h: 90,
            data: {
                src: "data:image/png;base64,base",
                annotationState: { elements: [], serialCounter: 1 },
                imageEditState: { contentEraseStrokes: [] },
            },
        } as any;

        const baseSignature = buildSyncedImageSignature(baseUnit);
        const changedSignature = buildSyncedImageSignature({
            ...baseUnit,
            data: {
                ...baseUnit.data,
                annotationState: {
                    elements: [
                        {
                            id: "annotation-1",
                            type: "line",
                            zIndex: 1,
                            points: [
                                { x: 10, y: 10 },
                                { x: 40, y: 30 },
                            ],
                            style: {
                                color: "#ffffff",
                                width: 2,
                            },
                        },
                    ],
                    serialCounter: 1,
                },
            },
        });

        expect(baseSignature).not.toEqual(changedSignature);
    });

    it("keeps the baked image signature stable across view-only minify and restore changes", () => {
        const fullUnit = {
            type: "sticker",
            w: 640,
            h: 360,
            data: {
                src: "data:image/png;base64,base",
                annotationState: {
                    elements: [
                        {
                            id: "annotation-1",
                            type: "line",
                            zIndex: 1,
                            points: [
                                { x: 10, y: 10 },
                                { x: 400, y: 200 },
                            ],
                            style: { color: "#ffffff", width: 4 },
                        },
                    ],
                    serialCounter: 1,
                },
            },
        } as any;
        const minifiedUnit = {
            ...fullUnit,
            w: 120,
            h: 120,
            data: {
                ...fullUnit.data,
                minified: true,
                savedRect: { x: 20, y: 30, w: 640, h: 360 },
                cropOffset: { x: 180, y: 70 },
            },
        } as any;

        expect(buildSyncedImageSignature(minifiedUnit)).toBe(
            buildSyncedImageSignature(fullUnit),
        );
    });

    it("invalidates baked previews when propagated sticker content geometry changes", () => {
        const baseUnit = {
            type: "sticker",
            w: 200,
            h: 100,
            data: {
                src: "data:image/png;base64,base",
                imageEditState: {
                    contentEraseStrokes: [],
                    cropRect: { x: 25, y: 0, w: 50, h: 100 },
                    sourceSize: { w: 100, h: 100 },
                },
                stickerEditPropagation: {
                    upstreamSourceFrame: { w: 100, h: 100 },
                    upstreamContentFrame: { x: 0, y: 0, w: 100, h: 100 },
                },
            },
        } as any;

        const baseSignature = buildSyncedImageSignature(baseUnit);
        const croppedSourceSignature = buildSyncedImageSignature({
            ...baseUnit,
            data: {
                ...baseUnit.data,
                stickerEditPropagation: {
                    ...baseUnit.data.stickerEditPropagation,
                    upstreamSourceFrame: { w: 50, h: 100 },
                    upstreamContentFrame: { x: 0, y: 0, w: 50, h: 100 },
                },
            },
        });

        expect(baseSignature).not.toEqual(croppedSourceSignature);
    });
});
