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
    });

    it("keeps request ordering isolated per unit", () => {
        const requestIds = ["request-a", "request-b"];
        const registry = createArtExecutionRequestRegistry(() => requestIds.shift() || "unexpected");

        const firstUnitRequest = registry.begin("first-node");
        const secondUnitRequest = registry.begin("second-node");

        expect(registry.isLatest("first-node", firstUnitRequest)).toBe(true);
        expect(registry.isLatest("second-node", secondUnitRequest)).toBe(true);
    });

    it("accepts legacy deliveries only when the unit has no tracked request", () => {
        const registry = createArtExecutionRequestRegistry(() => "request-a");

        expect(registry.isLatest("art-node")).toBe(true);
        registry.begin("art-node");
        expect(registry.isLatest("art-node")).toBe(false);
        registry.invalidate("art-node");
        expect(registry.isLatest("art-node")).toBe(true);
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

    it("does not let a legacy terminal delivery finish an active identified request", () => {
        const registry = createArtExecutionRequestRegistry(() => "request-a");
        const request = registry.begin("art-node");

        registry.finish("art-node");

        expect(registry.isLatest("art-node", request)).toBe(true);
    });
});
