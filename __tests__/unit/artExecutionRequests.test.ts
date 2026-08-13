import { describe, expect, it } from "vitest";
import { createArtExecutionRequestRegistry } from "../../src/services/artExecutionRequests";

describe("art execution request registry", () => {
    it("accepts only the latest request for a unit", () => {
        const requestIds = ["request-a", "request-b"];
        const registry = createArtExecutionRequestRegistry(() => requestIds.shift() || "unexpected");

        const first = registry.begin("art-node");
        const second = registry.begin("art-node");

        expect(registry.isLatest("art-node", first)).toBe(false);
        expect(registry.isLatest("art-node", second)).toBe(true);
        expect(registry.generation("art-node", first)).toBeUndefined();
        expect(registry.generation("art-node", second)).toBe(2);
    });

    it("keeps request ordering isolated per unit", () => {
        const requestIds = ["request-a", "request-b"];
        const registry = createArtExecutionRequestRegistry(() => requestIds.shift() || "unexpected");

        const firstUnitRequest = registry.begin("first-node");
        const secondUnitRequest = registry.begin("second-node");

        expect(registry.isLatest("first-node", firstUnitRequest)).toBe(true);
        expect(registry.isLatest("second-node", secondUnitRequest)).toBe(true);
    });

    it("tracks preview publication only for the current request", () => {
        const requestIds = ["request-a", "request-b"];
        const registry = createArtExecutionRequestRegistry(() => requestIds.shift() || "unexpected");
        const first = registry.begin("art-node");

        registry.markPreview("art-node", first, "preview-a");
        expect(registry.getPreview("art-node", first)).toBe("preview-a");

        const second = registry.begin("art-node");
        expect(registry.getPreview("art-node", first)).toBeUndefined();
        registry.markPreview("art-node", first, "stale-preview");
        expect(registry.getPreview("art-node", first)).toBeUndefined();
        registry.markPreview("art-node", second, "preview-b");
        expect(registry.getPreview("art-node", second)).toBe("preview-b");
    });

    it("rejects duplicate or late frames after the final phase finishes", () => {
        const registry = createArtExecutionRequestRegistry(() => "request-a");
        const request = registry.begin("art-node");
        registry.markPreview("art-node", request, "preview-a");

        registry.finish("art-node", request);

        expect(registry.getPreview("art-node", request)).toBeUndefined();
        expect(registry.isLatest("art-node", request)).toBe(false);
        registry.markPreview("art-node", request, "late-preview");
        expect(registry.getPreview("art-node", request)).toBeUndefined();
    });

    it("does not let a mismatched terminal delivery finish the active request", () => {
        const registry = createArtExecutionRequestRegistry(() => "request-a");
        const request = registry.begin("art-node");

        registry.finish("art-node", "request-other");

        expect(registry.isLatest("art-node", request)).toBe(true);
    });

    it("exposes the in-flight request before begin replaces it", () => {
        const requestIds = ["request-a", "request-b"];
        const registry = createArtExecutionRequestRegistry(() => requestIds.shift() || "unexpected");

        expect(registry.active("art-node")).toBeUndefined();
        const first = registry.begin("art-node");
        expect(registry.active("art-node")).toEqual({ requestId: first, generation: 1 });

        const second = registry.begin("art-node");
        expect(registry.active("art-node")).toEqual({ requestId: second, generation: 2 });

        registry.finish("art-node", second);
        expect(registry.active("art-node")).toBeUndefined();
    });
});
