import { describe, expect, it } from "vitest";
import type { FrozenStickerEntry } from "../../src/services/stickerSnapshot";
import {
    addRecycleBinEntry,
    cancelReferenceEntry,
    copyReferenceEntry,
    removeFrozenStickerEntry,
    restoreRecycleBinEntry,
    setReferenceEntry,
} from "../../src/services/stickerLibraryModel";

const createEntry = (index: number): FrozenStickerEntry => ({
    entryId: `entry-${index}`,
    sourceStickerId: `sticker-${index}`,
    createdAt: `2026-07-03T00:00:${String(index).padStart(2, "0")}.000Z`,
    snapshot: {
        id: `sticker-${index}`,
        src: `data:image/png;base64,${index}`,
        x: index,
        y: index + 1,
        w: 100,
        h: 80,
        minified: false,
        savedRect: null,
        cropOffset: null,
        opacityNormal: 1,
        opacityMini: 0.9,
        previewSrc: null,
        filePath: null,
        rasterizedAnnotationLayerSrc: null,
        annotationState: null,
        imageEditState: null,
        captureMeta: null,
    },
});

describe("stickerLibraryModel", () => {
    it("keeps only the latest 15 recycle-bin entries", () => {
        const entries = Array.from({ length: 16 }).reduce<FrozenStickerEntry[]>(
            (acc, _, index) => addRecycleBinEntry(acc, createEntry(index)),
            [],
        );

        expect(entries).toHaveLength(15);
        expect(entries[0].entryId).toBe("entry-1");
        expect(entries[14].entryId).toBe("entry-15");
    });

    it("restores an entry and removes it from the recycle bin", () => {
        const result = restoreRecycleBinEntry([createEntry(1)], "entry-1", { x: 10, y: 20 });

        expect(result.entries).toEqual([]);
        expect(result.restored.x).toBe(60);
        expect(result.restored.y).toBe(70);
        expect(result.restored.id).not.toBe("sticker-1");
    });

    it("stores a single frozen reference entry per source sticker and supports cancellation", () => {
        const first = createEntry(1);
        const second = {
            ...createEntry(2),
            sourceStickerId: "sticker-1",
        };

        const references = setReferenceEntry(setReferenceEntry([], first), second);

        expect(references).toHaveLength(1);
        expect(references[0].entryId).toBe("entry-2");
        expect(cancelReferenceEntry(references, "sticker-1")).toEqual([]);
    });

    it("copies a reference entry into a new sticker instance without removing the library entry", () => {
        const entries = [createEntry(3)];

        const copied = copyReferenceEntry(entries, "entry-3", { x: 30, y: 40 });

        expect(entries).toHaveLength(1);
        expect(copied.id).not.toBe("sticker-3");
        expect(copied.x).toBe(80);
        expect(copied.y).toBe(90);
        expect(copied.data.src).toBe("data:image/png;base64,3");
    });

    it("removes a frozen entry by entry id for recycle-bin or reference right click deletion", () => {
        const remaining = removeFrozenStickerEntry([createEntry(1), createEntry(2)], "entry-1");

        expect(remaining).toHaveLength(1);
        expect(remaining[0].entryId).toBe("entry-2");
    });
});
