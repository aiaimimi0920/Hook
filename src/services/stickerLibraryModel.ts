import type { Unit } from "../types/unit";
import {
    type FrozenStickerEntry,
    instantiateStickerFromFrozenSnapshot,
} from "./stickerSnapshot";

export const addRecycleBinEntry = (
    entries: FrozenStickerEntry[],
    next: FrozenStickerEntry,
): FrozenStickerEntry[] => [...entries, next].slice(-15);

export const restoreRecycleBinEntry = (
    entries: FrozenStickerEntry[],
    entryId: string,
    mouse: { x: number; y: number },
): { entries: FrozenStickerEntry[]; restored: Unit } => {
    const match = entries.find((entry) => entry.entryId === entryId);
    if (!match) {
        throw new Error(`Recycle entry not found: ${entryId}`);
    }

    return {
        entries: entries.filter((entry) => entry.entryId !== entryId),
        restored: instantiateStickerFromFrozenSnapshot(match, mouse),
    };
};

export const copyReferenceEntry = (
    entries: FrozenStickerEntry[],
    entryId: string,
    mouse: { x: number; y: number },
): Unit => {
    const match = entries.find((entry) => entry.entryId === entryId);
    if (!match) {
        throw new Error(`Reference entry not found: ${entryId}`);
    }

    return instantiateStickerFromFrozenSnapshot(match, mouse);
};

export const setReferenceEntry = (
    entries: FrozenStickerEntry[],
    next: FrozenStickerEntry,
): FrozenStickerEntry[] => [
    ...entries.filter((entry) => entry.sourceStickerId !== next.sourceStickerId),
    next,
];

export const cancelReferenceEntry = (
    entries: FrozenStickerEntry[],
    sourceStickerId: string,
): FrozenStickerEntry[] => entries.filter((entry) => entry.sourceStickerId !== sourceStickerId);

export const removeFrozenStickerEntry = (
    entries: FrozenStickerEntry[],
    entryId: string,
): FrozenStickerEntry[] => entries.filter((entry) => entry.entryId !== entryId);
