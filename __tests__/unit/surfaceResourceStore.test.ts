import { beforeEach, describe, expect, it } from "vitest";

import { surfaceResourceStore } from "../../src/store/surfaceResourceStore";

const resourceId = `sha256:${"a".repeat(64)}`;

describe("Surface resource cache", () => {
    beforeEach(() => surfaceResourceStore.actions.clearAll());

    it("deduplicates requests and resolves only unexpired verified-shaped entries", () => {
        expect(surfaceResourceStore.actions.begin(resourceId)).toBe(true);
        expect(surfaceResourceStore.actions.begin(resourceId)).toBe(false);
        expect(surfaceResourceStore.actions.complete(
            resourceId,
            "data:image/png;base64,AA==",
            Date.now() + 60_000,
        )).toBe(true);
        expect(surfaceResourceStore.actions.resolve(resourceId)).toBe(
            "data:image/png;base64,AA==",
        );
        expect(surfaceResourceStore.actions.begin(resourceId)).toBe(false);
    });

    it("rejects invalid and expired native deliveries", () => {
        expect(surfaceResourceStore.actions.complete(
            "resource:not-content-addressed",
            "data:image/png;base64,AA==",
            Date.now() + 60_000,
        )).toBe(false);
        expect(surfaceResourceStore.actions.complete(
            resourceId,
            "https://example.invalid/image.png",
            Date.now() + 60_000,
        )).toBe(false);
        expect(surfaceResourceStore.actions.complete(
            resourceId,
            "data:image/png;base64,AA==",
            Date.now() - 1,
        )).toBe(false);
        expect(surfaceResourceStore.actions.resolve(resourceId)).toBeUndefined();
    });

    it("allows retry after a failed fetch", () => {
        expect(surfaceResourceStore.actions.begin(resourceId)).toBe(true);
        surfaceResourceStore.actions.fail(resourceId);
        expect(surfaceResourceStore.actions.begin(resourceId)).toBe(true);
    });
});
