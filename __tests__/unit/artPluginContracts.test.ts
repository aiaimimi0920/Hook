import { describe, expect, it } from "vitest";
import { extractArtDeliveryCandidatesState } from "../../src/services/artDeliveryCandidates";
import {
    requiresFormalExecutionAfterPreview,
    shaderInputPortName,
    shaderReferenceInputPortName,
    supportsShaderPreview,
} from "../../src/services/artCapabilities";

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

    it("rejects old image-search delivery metadata", () => {
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

        expect(state).toEqual({
            resultCandidates: undefined,
            selectedResultIndex: undefined,
        });
    });

    it("uses package capability metadata as the only shader preview contract", () => {
        expect(
            supportsShaderPreview({
                metadata: { capabilities: { preview: "shader" } },
            }),
        ).toBe(true);
        expect(
            supportsShaderPreview({}),
        ).toBe(false);
        expect(
            supportsShaderPreview({
                metadata: { capabilities: { preview: "image" } },
            }),
        ).toBe(false);
    });

    it("describes hybrid workflow preview and formal execution separately", () => {
        const capability = {
            id: "workflow-art",
            label: "Workflow Art",
            description: "",
            supported_transports: ["websocket" as const],
            params: [],
            inputs: [
                { name: "input", label: "Source", type: "image" },
                { name: "input_2", label: "Reference", type: "image" },
            ],
            metadata: {
                capabilities: {
                    preview: "shader",
                    requiresFormalExecution: true,
                    shaderInput: "input",
                    shaderReferenceInput: "input_2",
                },
            },
        };

        expect(requiresFormalExecutionAfterPreview(capability)).toBe(true);
        expect(shaderInputPortName(capability)).toBe("input");
        expect(shaderReferenceInputPortName(capability)).toBe("input_2");
    });

    it("uses the second image input for contextual shader previews when metadata does not override it", () => {
        const capability = {
            id: "shader-art",
            label: "Shader Art",
            description: "",
            supported_transports: ["websocket" as const],
            params: [],
            inputs: [
                { name: "image", label: "Source", type: "image" },
                { name: "style", label: "Style", type: "image" },
            ],
        };

        expect(shaderInputPortName(capability)).toBe("image");
        expect(shaderReferenceInputPortName(capability)).toBe("style");
    });

    it("keeps workflow previews formal from the canonical execution envelope", () => {
        expect(
            requiresFormalExecutionAfterPreview({
                execution: { type: "workflow" },
            }),
        ).toBe(true);
    });
});
