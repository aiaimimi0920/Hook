import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/api", () => ({
    api: {
        cacheRemoteImageAsset: vi.fn(),
    },
}));

vi.mock("@tauri-apps/api/core", () => ({
    convertFileSrc: (path: string) => `asset://localhost/${path.replace(/\\/g, "/")}`,
}));

vi.mock("../../src/services/syncService", () => ({
    syncService: {
        performWorkflowSync: vi.fn().mockResolvedValue(undefined),
    },
}));

import type { DeliveryImageSearchCandidate } from "../../src/services/protocol";
import type { Unit } from "../../src/types/unit";
import {
    buildOptimisticImageSearchSelectionPatch,
    mergeImageSearchCandidateRuntimeState,
    orderImageSearchCandidatePrefetchQueue,
    prefetchImageSearchCandidateAssets,
    resolveImageSearchCandidateCardPreviewSrc,
} from "../../src/services/imageSearchCandidateCache";
import { graphStore } from "../../src/store/graphStore";
import { api } from "../../src/services/api";
import { syncService } from "../../src/services/syncService";

const BASE_CANDIDATES: DeliveryImageSearchCandidate[] = [
    {
        index: 0,
        title: "结果 1",
        imageUrl: "https://example.com/a.png",
        thumbnailUrl: "https://example.com/a-thumb.png",
    },
    {
        index: 1,
        title: "结果 2",
        imageUrl: "https://example.com/b.png",
        thumbnailUrl: "https://example.com/b-thumb.png",
    },
    {
        index: 2,
        title: "结果 3",
        imageUrl: "https://example.com/c.png",
    },
];

describe("imageSearchCandidateCache helpers", () => {
    beforeEach(() => {
        graphStore.setUnits([]);
        graphStore.setLinks([]);
        graphStore.setCapabilities([]);
        graphStore.setUnitParams({});
        graphStore.setUnitExecConfig({});
        vi.clearAllMocks();
    });

    it("keeps the selected candidate first in the prefetch queue and preserves remaining order", () => {
        const ordered = orderImageSearchCandidatePrefetchQueue(BASE_CANDIDATES, 2);

        expect(ordered.map((candidate) => candidate.index)).toEqual([2, 0, 1]);
    });

    it("preserves cached runtime fields across repeated image-search deliveries", () => {
        const merged = mergeImageSearchCandidateRuntimeState(
            [
                {
                    ...BASE_CANDIDATES[0],
                    cachedThumbnailSrc: "asset://cache/a-thumb.png",
                    cachedImageSrc: "asset://cache/a.png",
                    cachedImagePath: "C:\\cache\\a.png",
                },
            ],
            [
                {
                    ...BASE_CANDIDATES[0],
                },
                {
                    ...BASE_CANDIDATES[1],
                },
            ],
        );

        expect(merged).toEqual([
            {
                ...BASE_CANDIDATES[0],
                cachedThumbnailSrc: "asset://cache/a-thumb.png",
                cachedImageSrc: "asset://cache/a.png",
                cachedImagePath: "C:\\cache\\a.png",
            },
            {
                ...BASE_CANDIDATES[1],
            },
        ]);
    });

    it("prefers locally cached thumbnails over remote URLs for candidate cards", () => {
        expect(
            resolveImageSearchCandidateCardPreviewSrc({
                ...BASE_CANDIDATES[0],
                cachedThumbnailSrc: "asset://cache/a-thumb.png",
                cachedImageSrc: "asset://cache/a.png",
            }),
        ).toBe("asset://cache/a-thumb.png");
    });

    it("normalizes raw cached local thumbnail paths before returning them for candidate cards", () => {
        expect(
            resolveImageSearchCandidateCardPreviewSrc({
                ...BASE_CANDIDATES[0],
                cachedThumbnailSrc: "C:\\cache\\a-thumb.png",
            }),
        ).toBe("asset://localhost/C:/cache/a-thumb.png");
    });

    it("builds an optimistic selection patch from the cached full image when available", () => {
        const unit: Unit = {
            id: "node-image-search",
            type: "art",
            artId: "image-search",
            x: 20,
            y: 30,
            w: 320,
            h: 200,
            params: {
                query: "日本美女",
                count: 3,
                result_index: 0,
            },
            inputs: [],
            outputs: [],
            data: {
                previewSrc: "data:image/png;base64,OLD",
                outputs: {
                    output: "data:image/png;base64,OLD",
                    output_image: "data:image/png;base64,OLD",
                    file_path: "C:\\cache\\old.png",
                },
            },
        };

        expect(
            buildOptimisticImageSearchSelectionPatch(unit, {
                ...BASE_CANDIDATES[1],
                cachedImagePath: "C:\\cache\\b.png",
                cachedImageSrc: "asset://cache/b.png",
            }),
        ).toEqual({
            previewSrc: "asset://cache/b.png",
            filePath: "C:\\cache\\b.png",
            selectedResultIndex: 1,
            outputs: {
                output: "asset://cache/b.png",
                output_image: "asset://cache/b.png",
                file_path: "C:\\cache\\b.png",
            },
        });
    });

    it("marks a recoverable image-search node as completed once the selected candidate is cached locally", async () => {
        vi.mocked(api.cacheRemoteImageAsset).mockResolvedValue("C:\\cache\\a.png");

        const unit: Unit = {
            id: "node-image-search",
            type: "art",
            artId: "image-search",
            x: 20,
            y: 30,
            w: 320,
            h: 200,
            params: {
                query: "一只灰色的鹦鹉",
                count: 3,
                result_index: 0,
            },
            inputs: [],
            outputs: [],
            data: {
                nodeStatus: "error",
                errorMessage: "图片搜索已返回候选结果，但图片下载失败，请稍后重试。",
                imageSearchRecoveryPending: true,
                resultCandidates: [
                    {
                        ...BASE_CANDIDATES[0],
                    },
                ],
                selectedResultIndex: 0,
            },
        };
        graphStore.setUnits([unit]);

        await prefetchImageSearchCandidateAssets({
            unitId: unit.id,
            candidates: unit.data.resultCandidates,
            selectedIndex: 0,
        });

        expect(graphStore.units[0].data.nodeStatus).toBe("completed");
        expect(graphStore.units[0].data.errorMessage).toBeUndefined();
        expect(graphStore.units[0].data.imageSearchRecoveryPending).toBe(false);
        expect(graphStore.units[0].data.previewSrc).toBe("asset://localhost/C:/cache/a.png");
        expect(graphStore.units[0].data.filePath).toBe("C:\\cache\\a.png");
        expect(graphStore.units[0].data.outputs).toEqual({
            output: "asset://localhost/C:/cache/a.png",
            output_image: "asset://localhost/C:/cache/a.png",
            file_path: "C:\\cache\\a.png",
        });
        expect(syncService.performWorkflowSync).toHaveBeenCalled();
    });

    it("passes the candidate source page as referer when caching thumbnails and images", async () => {
        vi.mocked(api.cacheRemoteImageAsset)
            .mockResolvedValueOnce("C:\\cache\\a-thumb.png")
            .mockResolvedValueOnce("C:\\cache\\a.png");

        const candidateWithReferer: DeliveryImageSearchCandidate = {
            index: 0,
            title: "结果 1",
            imageUrl: "https://example.com/protected/a.png",
            thumbnailUrl: "https://example.com/protected/a-thumb.png",
            sourcePageUrl: "https://example.com/gallery/a",
        };
        graphStore.setUnits([
            {
                id: "node-image-search",
                type: "art",
                artId: "image-search",
                x: 20,
                y: 30,
                w: 320,
                h: 200,
                params: { query: "cake", result_index: 0 },
                inputs: [],
                outputs: [],
                data: {
                    resultCandidates: [candidateWithReferer],
                    selectedResultIndex: 0,
                },
            },
        ]);

        await prefetchImageSearchCandidateAssets({
            unitId: "node-image-search",
            candidates: [candidateWithReferer],
            selectedIndex: 0,
        });

        expect(api.cacheRemoteImageAsset).toHaveBeenNthCalledWith(
            1,
            "https://example.com/protected/a-thumb.png",
            "https://example.com/gallery/a",
        );
        expect(api.cacheRemoteImageAsset).toHaveBeenNthCalledWith(
            2,
            "https://example.com/protected/a.png",
            "https://example.com/gallery/a",
        );
    });
});
