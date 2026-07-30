import { describe, expect, it, vi } from "vitest";
import {
    buildSessionStickersForSave,
    mapUnitToSessionSticker,
} from "../../src/services/sessionStickerPayload";

const makeSticker = (overrides: Record<string, unknown> = {}) =>
    ({
        id: "sticker-1",
        type: "sticker",
        x: 10,
        y: 20,
        w: 160,
        h: 90,
        params: {},
        data: {
            src: "data:image/png;base64,BASE",
            previewSrc: undefined,
            minified: false,
            savedRect: undefined,
            cropOffset: undefined,
            opacityNormal: 1,
            opacityMini: 0.9,
            filePath: undefined,
            rasterizedAnnotationLayerSrc: undefined,
            outputs: undefined,
            originWorkflowId: undefined,
            originNodeId: undefined,
            executionConfig: undefined,
            annotationState: undefined,
            imageEditState: undefined,
            groupId: undefined,
            captureMeta: undefined,
        },
        ...overrides,
    }) as any;

describe("session sticker payload helpers", () => {
    it("maps plain stickers to normalized session payloads without rebaking", async () => {
        const unit = makeSticker({
            data: {
                ...makeSticker().data,
                previewSrc: "data:image/png;base64,PREVIEW",
            },
        });

        expect(mapUnitToSessionSticker(unit)).toMatchObject({
            id: "sticker-1",
            src: "data:image/png;base64,BASE",
            previewSrc: "data:image/png;base64,PREVIEW",
        });

        const renderBakedPreviewSrc = vi.fn();
        const result = await buildSessionStickersForSave([unit], {
            renderBakedPreviewSrc,
            previewCache: new Map(),
        });

        expect(renderBakedPreviewSrc).not.toHaveBeenCalled();
        expect(result).toEqual([
            expect.objectContaining({
                id: "sticker-1",
                previewSrc: "data:image/png;base64,PREVIEW",
            }),
        ]);
    });

    it("injects a baked preview for stickers whose visible result depends on Hook-only edit state", async () => {
        const unit = makeSticker({
            data: {
                ...makeSticker().data,
                annotationState: {
                    elements: [
                        {
                            id: "annotation-1",
                            type: "line",
                            zIndex: 1,
                            points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
                            style: { color: "#ffffff", width: 2 },
                        },
                    ],
                    serialCounter: 1,
                },
            },
        });

        const previewCache = new Map<string, { signature: string; src: string }>();
        const renderBakedPreviewSrc = vi.fn().mockResolvedValue("data:image/png;base64,BAKED");

        const result = await buildSessionStickersForSave([unit], {
            renderBakedPreviewSrc,
            previewCache,
        });

        expect(renderBakedPreviewSrc).toHaveBeenCalledTimes(1);
        expect(result[0]).toMatchObject({
            id: "sticker-1",
            previewSrc: "data:image/png;base64,BAKED",
        });
        expect(previewCache.size).toBe(1);
    });

    it("reuses cached baked previews when the sticker sync signature is unchanged", async () => {
        const unit = makeSticker({
            data: {
                ...makeSticker().data,
                annotationState: {
                    elements: [
                        {
                            id: "annotation-1",
                            type: "line",
                            zIndex: 1,
                            points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
                            style: { color: "#ffffff", width: 2 },
                        },
                    ],
                    serialCounter: 1,
                },
            },
        });

        const renderBakedPreviewSrc = vi.fn();
        const previewCache = new Map<string, { signature: string; src: string }>();

        const first = await buildSessionStickersForSave([unit], {
            renderBakedPreviewSrc: vi.fn().mockResolvedValue("data:image/png;base64,BAKED"),
            previewCache,
        });

        const second = await buildSessionStickersForSave([unit], {
            renderBakedPreviewSrc,
            previewCache,
        });

        expect(first[0].previewSrc).toBe("data:image/png;base64,BAKED");
        expect(second[0].previewSrc).toBe("data:image/png;base64,BAKED");
        expect(renderBakedPreviewSrc).not.toHaveBeenCalled();
    });

    it("falls back to the base session payload when baking fails", async () => {
        const unit = makeSticker({
            data: {
                ...makeSticker().data,
                annotationState: {
                    elements: [
                        {
                            id: "annotation-1",
                            type: "line",
                            zIndex: 1,
                            points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
                            style: { color: "#ffffff", width: 2 },
                        },
                    ],
                    serialCounter: 1,
                },
            },
        });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

        const result = await buildSessionStickersForSave([unit], {
            renderBakedPreviewSrc: vi.fn().mockRejectedValue(new Error("boom")),
            previewCache: new Map(),
        });

        expect(result[0]).toMatchObject({
            id: "sticker-1",
            previewSrc: null,
            src: "data:image/png;base64,BASE",
        });
        consoleError.mockRestore();
    });

    it("prefers live param overrides when persisting a session sticker", async () => {
        const unit = makeSticker({
            type: "art",
            artId: "custom-1770177813416",
            params: {
                force_update: 1,
            },
        });

        const result = await buildSessionStickersForSave([unit], {
            renderBakedPreviewSrc: vi.fn(),
            previewCache: new Map(),
            paramsByUnitId: {
                "sticker-1": {
                    query: "日本美女",
                    force_update: 2,
                },
            },
        });

        expect(result[0]).toMatchObject({
            id: "sticker-1",
            params: {
                query: "日本美女",
                force_update: 2,
            },
        });
    });
});
