import { afterEach, describe, expect, it } from "vitest";
import type { Unit } from "../../src/types/unit";
import { buildSyncedImageSignature } from "../../src/services/syncedImagePayload";
import {
    deleteBakedSyncPreviewCacheEntry,
    resolveCachedBakedSyncPreview,
    setBakedSyncPreviewCacheEntry,
} from "../../src/services/syncImageCache";

const UNIT_ID = "opacity-cache-regression";
const DISPLAY_SRC = "data:image/png;base64,display";

const sticker = (opacityNormal: number | undefined, annotated: boolean): Unit => ({
    id: UNIT_ID,
    type: "sticker",
    x: 0, y: 0, w: 160, h: 90,
    params: {}, inputs: [], outputs: [],
    data: {
        src: DISPLAY_SRC,
        opacityNormal,
        annotationState: {
            serialCounter: 1,
            elements: annotated ? [{
                id: "line", type: "line", zIndex: 1,
                points: [{ x: 10, y: 10 }, { x: 40, y: 30 }],
                style: { color: "#ffffff", width: 2 },
            }] : [],
        },
    },
});

afterEach(() => deleteBakedSyncPreviewCacheEntry(UNIT_ID));

describe("baked sync preview opacity invalidation", () => {
    it.each([
        { label: "plain sticker from 0.5 to 0.8", from: 0.5, to: 0.8, annotated: false },
        { label: "annotated sticker from 1 to 0.5", from: 1, to: 0.5, annotated: true },
    ])("rejects the stale cached bitmap for $label", ({ from, to, annotated }) => {
        const previous = sticker(from, annotated);
        const signature = buildSyncedImageSignature(previous, { displaySrcOverride: DISPLAY_SRC })!;
        setBakedSyncPreviewCacheEntry(UNIT_ID, { signature, src: "baked-before-opacity-edit" });
        expect(resolveCachedBakedSyncPreview(previous, DISPLAY_SRC)).toBe("baked-before-opacity-edit");

        const edited = sticker(to, annotated);
        const nextSignature = buildSyncedImageSignature(edited, { displaySrcOverride: DISPLAY_SRC });
        expect(resolveCachedBakedSyncPreview(edited, DISPLAY_SRC)).toBeUndefined();
        expect(nextSignature).not.toBe(signature);

        setBakedSyncPreviewCacheEntry(UNIT_ID, { signature: nextSignature!, src: "baked-after-opacity-edit" });
        expect(resolveCachedBakedSyncPreview(edited, DISPLAY_SRC)).toBe("baked-after-opacity-edit");
    });

    it("treats omitted opacity as the renderer's default of one", () => {
        expect(buildSyncedImageSignature(sticker(undefined, true))).toBe(
            buildSyncedImageSignature(sticker(1, true)),
        );
    });

    it("invalidates a fully transparent bitmap when opacity increases", () => {
        expect(buildSyncedImageSignature(sticker(0, false))).not.toBe(
            buildSyncedImageSignature(sticker(0.5, false)),
        );
    });
});
