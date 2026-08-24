//! Serializes backend click-through rect updates and always sends the latest state.

import { graphStore } from "../../store/graphStore";
import { api } from "../api";
import { extraRects } from "../uiRegistry";

let syncRequested = false;
let syncPromise: Promise<void> | null = null;

const syncLatestBackendRects = async (): Promise<void> => {
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

    try {
        await api.updatePinRects(rects);
    } catch (error) {
        console.error("Failed to update backend rects:", error);
    }
};

export const requestBackendRectSync = (): Promise<void> => {
    syncRequested = true;
    if (!syncPromise) {
        syncPromise = (async () => {
            while (syncRequested) {
                syncRequested = false;
                await syncLatestBackendRects();
            }
        })().finally(() => {
            syncPromise = null;
        });
    }
    return syncPromise;
};
