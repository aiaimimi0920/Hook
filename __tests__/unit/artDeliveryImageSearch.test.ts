import { describe, expect, it } from "vitest";

import { extractArtDeliveryImageSearchState } from "../../src/services/artDeliveryImageSearch";

describe("extractArtDeliveryImageSearchState", () => {
    it("normalizes delivery image-search candidates and the selected index", () => {
        expect(
            extractArtDeliveryImageSearchState({
                imageSearch: {
                    selectedIndex: 1,
                    candidates: [
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
                        },
                    ],
                },
            }),
        ).toEqual({
            resultCandidates: [
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
                },
            ],
            selectedResultIndex: 1,
        });
    });

    it("drops malformed candidates and returns undefined state when nothing usable remains", () => {
        expect(
            extractArtDeliveryImageSearchState({
                imageSearch: {
                    selectedIndex: 0,
                    candidates: [
                        {
                            index: "bad",
                            imageUrl: "https://example.com/a.png",
                        },
                        {
                            index: 1,
                        },
                    ],
                },
            }),
        ).toEqual({
            resultCandidates: undefined,
            selectedResultIndex: undefined,
        });
    });
});
