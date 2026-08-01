import { describe, expect, it } from "vitest";
import { extractArtDeliveryCandidatesState } from "../../src/services/artDeliveryCandidates";
import { supportsShaderPreview } from "../../src/services/artCapabilities";

describe("generic Art plugin contracts", () => {
    it("reads generic candidate metadata without requiring the legacy imageSearch field", () => {
        const state = extractArtDeliveryCandidatesState({
            candidates: {
                kind: "image.candidates",
                selectedIndex: 1,
                items: [
                    {
                        index: 0,
                        imageUrl: "https://example.test/a.png",
                        thumbnail: "data:image/png;base64,THUMB_A",
                    },
                    {
                        index: 1,
                        imageUrl: "https://example.test/b.png",
                        preview: "data:image/png;base64,PREVIEW_B",
                    },
                ],
            },
        });

        expect(state.resultCandidates).toHaveLength(2);
        expect(state.resultCandidates?.[0].thumbnail).toBe(
            "data:image/png;base64,THUMB_A",
        );
        expect(state.selectedResultIndex).toBe(1);
    });

    it("keeps legacy image-search delivery readable during protocol migration", () => {
        const state = extractArtDeliveryCandidatesState({
            imageSearch: {
                selectedIndex: 0,
                candidates: [
                    {
                        index: 0,
                        imageUrl: "https://example.test/legacy.png",
                    },
                ],
            },
        });

        expect(state.resultCandidates?.[0].imageUrl).toBe(
            "https://example.test/legacy.png",
        );
        expect(state.selectedResultIndex).toBe(0);
    });

    it("uses capability metadata for shader previews and keeps the legacy fallback", () => {
        expect(
            supportsShaderPreview({
                execution_type: "script",
                metadata: { capabilities: { preview: "shader" } },
            }),
        ).toBe(true);
        expect(
            supportsShaderPreview({
                execution_type: "shader",
            }),
        ).toBe(true);
        expect(
            supportsShaderPreview({
                execution_type: "script",
                metadata: { capabilities: { preview: "image" } },
            }),
        ).toBe(false);
    });
});
