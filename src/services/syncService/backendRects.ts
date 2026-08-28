//! Serializes backend click-through rect updates and always sends the latest state.

import { graphStore } from "../../store/graphStore";
import { api } from "../api";
import { extraRects } from "../uiRegistry";

type BackendRects = Awaited<Parameters<typeof api.updatePinRects>[0]>;

let pendingRects: BackendRects | null = null;
let syncPromise: Promise<void> | null = null;

const captureBackendRects = (): BackendRects => {
    const dpr = window.devicePixelRatio || 1;
    const rects = graphStore.units.map((unit) => ({
        id: unit.id,
        x: Math.round(unit.x * dpr),
        y: Math.round(unit.y * dpr),
        width: Math.round(unit.w * dpr),
        height: Math.round(unit.h * dpr),
        name: unit.data.minified ? "MINI" : "FULL",
    }));

    extraRects().forEach((rect) => {
        rects.push({
            id: rect.name,
            x: Math.round(rect.x * dpr),
            y: Math.round(rect.y * dpr),
            width: Math.round(rect.width * dpr),
            height: Math.round(rect.height * dpr),
            name: rect.name,
        });
    });

    return rects;
};

const syncBackendRects = async (rects: BackendRects): Promise<void> => {
    try {
        await api.updatePinRects(rects);
    } catch (error) {
        console.error("Failed to update backend rects:", error);
    }
};

export const requestBackendRectSync = (): Promise<void> => {
    // Capture before entering the async queue. Besides preserving latest-state
    // coalescing, this keeps Solid effects subscribed even while a send is active.
    pendingRects = captureBackendRects();
    if (!syncPromise) {
        syncPromise = (async () => {
            while (pendingRects) {
                const rects = pendingRects;
                pendingRects = null;
                await syncBackendRects(rects);
            }
        })().finally(() => {
            syncPromise = null;
        });
    }
    return syncPromise;
};
