import { describe, expect, it, vi } from "vitest";
import {
    findArtCapability,
    findArtCapabilityAfterRefresh,
} from "../../src/services/artCapabilityLookup";
import type { ArtCapability } from "../../src/services/protocol";

const colorTransfer: ArtCapability = {
    id: "neuro.official/custom-1770131241684",
    legacyId: "custom-1770131241684",
    qualifiedId: "neuro.official/custom-1770131241684",
    label: "颜色迁移",
    description: "",
    supported_transports: ["shared_memory"],
    params: [],
};

describe("Art capability lookup", () => {
    it("resolves legacy and qualified Art identifiers to the canonical capability", () => {
        expect(findArtCapability([colorTransfer], colorTransfer.legacyId)).toBe(colorTransfer);
        expect(findArtCapability([colorTransfer], colorTransfer.qualifiedId)).toBe(colorTransfer);
    });

    it("refreshes an empty catalog before resolving a quick Art binding", async () => {
        let capabilities: ArtCapability[] = [];
        const refresh = vi.fn(async () => {
            capabilities = [colorTransfer];
        });

        const resolved = await findArtCapabilityAfterRefresh(
            "custom-1770131241684",
            () => capabilities,
            refresh,
        );

        expect(refresh).toHaveBeenCalledOnce();
        expect(resolved).toBe(colorTransfer);
    });

    it("does not refresh when the requested Art is already loaded", async () => {
        const refresh = vi.fn(async () => undefined);

        const resolved = await findArtCapabilityAfterRefresh(
            colorTransfer.id,
            () => [colorTransfer],
            refresh,
        );

        expect(refresh).not.toHaveBeenCalled();
        expect(resolved).toBe(colorTransfer);
    });
});
