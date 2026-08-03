import { beforeEach, describe, expect, it } from "vitest";

import { graphStore } from "../../src/store/graphStore";
import type { Unit } from "../../src/types/unit";
import {
    getImageSearchPrefetchGenerationCount,
    nextImageSearchPrefetchGeneration,
} from "../../src/services/imageSearchPrefetchGeneration";
import {
    bakedSyncPreviewCache,
    getSyncImageCacheEpoch,
    getSyncImageCacheToken,
    isSyncImageCacheEpochCurrent,
    isSyncImageCacheTokenCurrent,
    lastSyncedImageSignatures,
} from "../../src/services/syncImageCache";

const unit = (id: string): Unit => ({
    id,
    type: "sticker",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    data: {},
    params: {},
    inputs: [],
    outputs: [],
});

describe("unit-scoped cache lifecycle", () => {
    beforeEach(() => {
        graphStore.actions.replaceUnits([]);
        graphStore.setLinks([]);
        graphStore.setUnitParams({});
        graphStore.setUnitExecConfig({});
    });

    it("reclaims image-search and sync caches immediately when a unit is deleted", () => {
        graphStore.setUnits([unit("removed")]);
        nextImageSearchPrefetchGeneration("removed");
        lastSyncedImageSignatures.set("workflow:removed", "signature");
        bakedSyncPreviewCache.set("removed", { signature: "signature", src: "preview" });

        graphStore.actions.removeUnit("removed");

        expect(getImageSearchPrefetchGenerationCount()).toBe(0);
        expect(lastSyncedImageSignatures.size).toBe(0);
        expect(bakedSyncPreviewCache.size).toBe(0);
    });

    it("clears all unit-scoped caches before replacing a workspace", () => {
        const workspaceEpoch = getSyncImageCacheEpoch();
        nextImageSearchPrefetchGeneration("old");
        const oldToken = getSyncImageCacheToken("old");
        graphStore.setUnitParams({ old: { amount: 1 } });
        graphStore.setUnitExecConfig({ old: { mode: "manual" } });
        lastSyncedImageSignatures.set("workflow:old", "signature");
        bakedSyncPreviewCache.set("old", { signature: "signature", src: "preview" });

        graphStore.actions.replaceUnits([unit("new")]);

        expect(graphStore.units.map((entry) => entry.id)).toEqual(["new"]);
        expect(getImageSearchPrefetchGenerationCount()).toBe(0);
        expect(lastSyncedImageSignatures.size).toBe(0);
        expect(bakedSyncPreviewCache.size).toBe(0);
        expect(graphStore.unitParams).toEqual({});
        expect(graphStore.unitExecConfig).toEqual({});
        expect(isSyncImageCacheEpochCurrent(workspaceEpoch)).toBe(false);
        expect(isSyncImageCacheTokenCurrent("old", oldToken)).toBe(false);
    });

    it("invalidates an in-flight unit cache token when the unit is deleted", () => {
        graphStore.setUnits([unit("removed")]);
        const token = getSyncImageCacheToken("removed");

        graphStore.actions.removeUnit("removed");

        expect(isSyncImageCacheTokenCurrent("removed", token)).toBe(false);
        if (isSyncImageCacheTokenCurrent("removed", token)) {
            bakedSyncPreviewCache.set("removed", {
                signature: "late-signature",
                src: "late-preview",
            });
        }
        expect(bakedSyncPreviewCache.has("removed")).toBe(false);
    });
});
