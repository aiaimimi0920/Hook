import { describe, expect, it, vi } from "vitest";
import {
    findArtCapability,
    findArtCapabilityAfterRefresh,
} from "../../src/services/artCapabilityLookup";
import type { ArtCapability } from "../../src/services/protocol";

const colorTransfer: ArtCapability = {
    id: "neuro.official/custom-1770131241684",
    label: "颜色迁移",
    description: "",
    supported_transports: ["shared_memory"],
    params: [],
};

describe("Art capability lookup", () => {
    it("resolves only the canonical Art identifier", () => {
        expect(findArtCapability([colorTransfer], colorTransfer.id)).toBe(colorTransfer);
        expect(findArtCapability([colorTransfer], "custom-1770131241684")).toBeUndefined();
    });

    it("refreshes an empty catalog before resolving a quick Art binding", async () => {
        let capabilities: ArtCapability[] = [];
        const refresh = vi.fn(async () => {
            capabilities = [colorTransfer];
        });

        const resolved = await findArtCapabilityAfterRefresh(
            colorTransfer.id,
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
