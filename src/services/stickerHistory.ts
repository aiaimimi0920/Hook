import { unwrap } from "solid-js/store";
import { createEmptyAnnotationState, createEmptyImageEditState } from "./stickerEditing";
import type { StickerAnnotationState, StickerImageEditState } from "../types/stickerEditing";
import type { Unit } from "../types/unit";

export interface StickerEditSnapshot {
    unitRect: { x: number; y: number; w: number; h: number };
    annotationState: StickerAnnotationState;
    imageEditState: StickerImageEditState;
    imageData?: Pick<
        Unit["data"],
        "src" | "previewSrc" | "resultHandle" | "filePath" | "rasterizedAnnotationLayerSrc"
    >;
}

export interface StickerEditHistory {
    past: StickerEditSnapshot[];
    future: StickerEditSnapshot[];
}

interface CaptureStickerEditSnapshotOptions {
    includeImageData?: boolean;
}

const cloneSnapshot = (snapshot: StickerEditSnapshot): StickerEditSnapshot =>
    structuredClone(unwrap(snapshot));

export const createEmptyStickerHistory = (): StickerEditHistory => ({
    past: [],
    future: [],
});

export const captureStickerEditSnapshot = (
    unit: Unit,
    options?: CaptureStickerEditSnapshotOptions,
): StickerEditSnapshot => {
    const snapshot: StickerEditSnapshot = {
        unitRect: {
            x: unit.x,
            y: unit.y,
            w: unit.w,
            h: unit.h,
        },
        annotationState: structuredClone(unwrap(unit.data.annotationState || createEmptyAnnotationState())),
        imageEditState: structuredClone(unwrap(unit.data.imageEditState || createEmptyImageEditState())),
    };

    if (options?.includeImageData) {
        snapshot.imageData = structuredClone(unwrap({
            src: unit.data.src,
            previewSrc: unit.data.previewSrc,
            resultHandle: unit.data.resultHandle,
            filePath: unit.data.filePath,
            rasterizedAnnotationLayerSrc: unit.data.rasterizedAnnotationLayerSrc,
        }));
    }

    return snapshot;
};

export const pushStickerHistorySnapshot = (
    history: StickerEditHistory,
    snapshot: StickerEditSnapshot,
    limit = 50,
): StickerEditHistory => {
    const nextPast = [...history.past, cloneSnapshot(snapshot)];
    const trimmedPast = nextPast.length > limit ? nextPast.slice(nextPast.length - limit) : nextPast;
    return {
        past: trimmedPast,
        future: [],
    };
};

export const undoStickerHistorySnapshot = (
    history: StickerEditHistory,
    current: StickerEditSnapshot,
): { history: StickerEditHistory; snapshot?: StickerEditSnapshot } => {
    if (history.past.length === 0) {
        return { history };
    }

    const previous = history.past[history.past.length - 1];
    return {
        snapshot: cloneSnapshot(previous),
        history: {
            past: history.past.slice(0, -1),
            future: [cloneSnapshot(current), ...history.future],
        },
    };
};

export const redoStickerHistorySnapshot = (
    history: StickerEditHistory,
    current: StickerEditSnapshot,
    limit = 50,
): { history: StickerEditHistory; snapshot?: StickerEditSnapshot } => {
    if (history.future.length === 0) {
        return { history };
    }

    const [next, ...remainingFuture] = history.future;
    const nextPast = [...history.past, cloneSnapshot(current)];
    const trimmedPast = nextPast.length > limit ? nextPast.slice(nextPast.length - limit) : nextPast;
    return {
        snapshot: cloneSnapshot(next),
        history: {
            past: trimmedPast,
            future: remainingFuture,
        },
    };
};
