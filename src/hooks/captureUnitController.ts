import { convertFileSrc } from "@tauri-apps/api/core";

import { api } from "../services/api";
import {
    type CaptureRect,
    createCaptureMeta,
    type LongCaptureAxis,
    type ManualLongCaptureFrame,
} from "../services/captureState";
import { createThumbnailDataUrl } from "../services/historyModel";
import { syncService } from "../services/syncService";
import { graphStore } from "../store/graphStore";
import {
    captureMode,
    selectionActions,
    uiActions,
} from "../store/uiStore";
import type { Unit } from "../types/unit";

const resolveCaptureResponseSrc = (response: ManualLongCaptureFrame) => {
    if (response.filePath) {
        return convertFileSrc(response.filePath);
    }
    return response.fileUrl ?? response.base64;
};

/** Restores normal overlay hit testing after every capture exit path. */
export const restorePostCaptureInteractivity = async () => {
    await api.setOverlayClickThrough(true);
    if (graphStore.units.length > 0) {
        await api.setMouseMonitorActive(true);
        await syncService.updateBackendRects();
    }
};

/** Commits a captured frame as a selected sticker, then records history asynchronously. */
export const addCaptureUnit = async (
    response: ManualLongCaptureFrame,
    rect: CaptureRect,
    origin: { x: number; y: number },
    mode = captureMode(),
    scrollAxis?: LongCaptureAxis,
) => {
    const dpr = window.devicePixelRatio || 1;
    const cssW = response.width / dpr;
    const cssH = response.height / dpr;

    const newUnit: Unit = {
        id: crypto.randomUUID(),
        type: "sticker",
        x: origin.x,
        y: origin.y,
        w: cssW,
        h: cssH,
        params: {},
        inputs: [],
        outputs: [],
        data: {
            src: resolveCaptureResponseSrc(response),
            filePath: response.filePath ?? undefined,
            opacityNormal: 1.0,
            opacityMini: 0.9,
            minified: false,
            captureMeta: {
                ...createCaptureMeta(mode, rect, scrollAxis),
                dynamicRange: response.dynamicRange,
                bitDepth: response.bitDepth,
                colorSpace: response.colorSpace,
                captureBackend: response.captureBackend,
                downgradedFromHdr: response.downgradedFromHdr,
            },
        },
    };

    graphStore.actions.addUnit(newUnit);
    selectionActions.set([newUnit.id]);
    await api.focusOverlayWindow();
    await syncService.updateBackendRects();
    void syncService.performWorkflowSync();
    await api.debugLogEvent("selection-capture-success", `cssW=${cssW} cssH=${cssH}`);

    // Thumbnail generation is intentionally detached from the capture success path.
    void (async () => {
        try {
            const thumb = await createThumbnailDataUrl(newUnit.data.src ?? "");
            if (!thumb.thumbnail) return;
            uiActions.recordScreenshotHistory({
                id: newUnit.id,
                thumbnail: thumb.thumbnail,
                width: response.width,
                height: response.height,
                at: Date.now(),
            });
        } catch (error) {
            console.error("Failed to record screenshot history", error);
        }
    })();
};
