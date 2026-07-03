import { describe, expect, it } from "vitest";
import type { Unit } from "../../src/types/unit";
import {
    createEmptyAnnotationState,
    createEmptyImageEditState,
} from "../../src/services/stickerEditing";
import {
    captureFrozenStickerSnapshot,
    instantiateStickerFromFrozenSnapshot,
} from "../../src/services/stickerSnapshot";

const createSticker = (): Unit => ({
    id: "sticker-1",
    type: "sticker",
    x: 10,
    y: 20,
    w: 200,
    h: 120,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        src: "data:image/png;base64,source",
        previewSrc: "data:image/png;base64,preview",
        opacityNormal: 0.8,
        opacityMini: 0.5,
        annotationState: createEmptyAnnotationState(),
        imageEditState: {
            ...createEmptyImageEditState(),
            cropRect: { x: 1, y: 2, w: 30, h: 40 },
            sourceSize: { w: 200, h: 120 },
            borderWidth: 2,
            borderColor: "#ffffff",
            cornerRadius: 6,
        },
    },
});

describe("stickerSnapshot", () => {
    it("captures a frozen full sticker snapshot without retaining live object references", () => {
        const unit = createSticker();
        const snapshot = captureFrozenStickerSnapshot(unit);

        unit.data.opacityNormal = 0.1;
        unit.data.imageEditState!.borderColor = "#000000";

        expect(snapshot.snapshot.opacityNormal).toBe(0.8);
        expect(snapshot.snapshot.imageEditState?.borderColor).toBe("#ffffff");
        expect(snapshot.snapshot.id).toBe("sticker-1");
    });

    it("instantiates a new sticker instance from a frozen snapshot at a +50,+50 mouse offset", () => {
        const snapshot = captureFrozenStickerSnapshot(createSticker());

        const restored = instantiateStickerFromFrozenSnapshot(snapshot, { x: 300, y: 400 });

        expect(restored.id).not.toBe("sticker-1");
        expect(restored.x).toBe(350);
        expect(restored.y).toBe(450);
        expect(restored.data.previewSrc).toBe("data:image/png;base64,preview");
        expect(restored.data.imageEditState?.cropRect).toEqual({ x: 1, y: 2, w: 30, h: 40 });
    });
});
