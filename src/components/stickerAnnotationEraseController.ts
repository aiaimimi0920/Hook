import { createSignal, onCleanup, type Accessor } from "solid-js";

import {
    applyContentEraseToBaseLayer,
    applyRasterizedContentErase,
    createLiveStickerEraseSession,
    type LiveStickerEraseMode,
    type LiveStickerEraseSession,
} from "../services/stickerBitmapLayers";
import { createEmptyImageEditState } from "../services/stickerEditing";
import { renderStickerBaseLayer } from "../services/stickerExport";
import { LiveEraseQueue } from "../services/liveEraseQueue";
import { stickerToolSettings } from "../store/uiStore";
import type { ContentEraserStroke, StickerPoint } from "../types/stickerEditing";
import type { Unit } from "../types/unit";

interface PatchOptions {
    propagateEdit?: boolean;
    markLocalEdit?: boolean;
}

interface StickerAnnotationEraseControllerOptions {
    host: Accessor<HTMLDivElement | undefined>;
    width: Accessor<number>;
    height: Accessor<number>;
    unit: Accessor<Unit | undefined>;
    patchUnitData: (
        patch: Partial<Unit["data"]>,
        options?: PatchOptions,
    ) => Promise<void>;
    rememberCurrentState: (includeImageData?: boolean) => void;
}

export interface ActiveLiveEraseResult {
    mode: LiveStickerEraseMode;
    finished: boolean;
}

// Own decoded canvas sessions and their queue/generation lifetime. Pointer
// routing only submits points; PNG encoding and graph writes remain pointer-up work.
export const createStickerAnnotationEraseController = (
    options: StickerAnnotationEraseControllerOptions,
) => {
    let liveErasePreviewRef: HTMLCanvasElement | undefined;
    const [liveErasePreviewVisible, setLiveErasePreviewVisible] = createSignal(false);
    const liveEraseQueue = new LiveEraseQueue();
    let liveEraseSession: LiveStickerEraseSession | null = null;
    let liveEraseInitialization: Promise<boolean> | null = null;
    let liveEraseMode: LiveStickerEraseMode | null = null;
    let liveErasePendingPoints: StickerPoint[] = [];
    let liveEraseStrokePoints: StickerPoint[] = [];

    const setLiveErasePreviewActive = (active: boolean) => {
        const container = options.host()?.closest<HTMLElement>(".unit-container");
        if (active) {
            container?.setAttribute("data-live-erase-preview", "true");
        } else {
            container?.removeAttribute("data-live-erase-preview");
        }
        setLiveErasePreviewVisible(active);
    };

    const resetLiveEraseRuntime = () => {
        liveEraseSession?.destroy();
        liveEraseSession = null;
        liveEraseInitialization = null;
        liveEraseMode = null;
        liveErasePendingPoints = [];
        liveEraseStrokePoints = [];
        setLiveErasePreviewActive(false);
    };

    const commitContentErase = async (stroke: ContentEraserStroke) => {
        const currentUnit = options.unit();
        const layerSrc = currentUnit?.data.rasterizedAnnotationLayerSrc;
        if (!currentUnit || stroke.points.length < 1) return false;

        // Browser image decode, canvas readback and PNG encoding can reject.
        // Pointer handlers invoke this asynchronously, so contain failures here.
        try {
            const baseLayerSrc = await renderStickerBaseLayer(currentUnit);
            options.rememberCurrentState(true);

            if (!layerSrc) {
                const nextBaseLayerSrc = await applyContentEraseToBaseLayer({
                    baseLayerSrc,
                    size: { w: options.width(), h: options.height() },
                    stroke,
                });
                await options.patchUnitData({
                    src: nextBaseLayerSrc,
                    previewSrc: nextBaseLayerSrc,
                    resultHandle: undefined,
                    filePath: undefined,
                    imageEditState: createEmptyImageEditState(),
                }, { propagateEdit: true });
                return true;
            }

            const next = await applyRasterizedContentErase({
                baseLayerSrc,
                rasterizedAnnotationLayerSrc: layerSrc,
                size: { w: options.width(), h: options.height() },
                stroke,
            });
            await options.patchUnitData({
                src: next.baseLayerSrc,
                previewSrc: next.previewSrc,
                rasterizedAnnotationLayerSrc: next.rasterizedAnnotationLayerSrc,
                resultHandle: undefined,
                filePath: undefined,
                imageEditState: createEmptyImageEditState(),
            }, { propagateEdit: true });
            return true;
        } catch (error) {
            console.error("[Hook] Failed to commit content erase", error);
            return false;
        }
    };

    const initializeLiveEraseSession = async (
        mode: LiveStickerEraseMode,
        generation: number,
        currentUnit: Unit,
    ) => {
        if (!liveErasePreviewRef) return false;

        try {
            const baseLayerSrc = mode === "content"
                ? await renderStickerBaseLayer(currentUnit)
                : currentUnit.data.src || currentUnit.data.previewSrc;
            const rasterizedAnnotationLayerSrc = currentUnit.data.rasterizedAnnotationLayerSrc;
            if (
                !baseLayerSrc ||
                (mode === "annotations" && !rasterizedAnnotationLayerSrc) ||
                !liveEraseQueue.isCurrent(generation)
            ) {
                return false;
            }

            const session = await createLiveStickerEraseSession({
                mode,
                baseLayerSrc,
                rasterizedAnnotationLayerSrc,
                size: { w: options.width(), h: options.height() },
                previewCanvas: liveErasePreviewRef,
            });
            if (!liveEraseQueue.isCurrent(generation)) {
                session.destroy();
                return false;
            }

            options.rememberCurrentState(true);
            liveEraseSession = session;
            setLiveErasePreviewActive(true);
            if (liveErasePendingPoints.length > 0) {
                session.queueErase(liveErasePendingPoints, stickerToolSettings.contentEraserSize);
                liveErasePendingPoints = [];
            }
            return true;
        } catch (error) {
            console.error("[Hook] Failed to initialize live erase canvas", error);
            return false;
        }
    };

    const beginLiveErase = (mode: LiveStickerEraseMode, point: StickerPoint) => {
        const currentUnit = options.unit();
        if (
            !currentUnit ||
            (mode === "annotations" &&
                (!currentUnit.data.rasterizedAnnotationLayerSrc ||
                    !(currentUnit.data.src || currentUnit.data.previewSrc)))
        ) {
            return false;
        }

        liveEraseSession?.destroy();
        liveEraseSession = null;
        setLiveErasePreviewActive(false);
        liveEraseMode = mode;
        liveErasePendingPoints = [point];
        liveEraseStrokePoints = [point];
        const generation = liveEraseQueue.begin();
        liveEraseInitialization = initializeLiveEraseSession(mode, generation, currentUnit);
        return true;
    };

    const applyLiveErase = (points: StickerPoint[]) =>
        liveEraseQueue.apply(points, async (batch, generation) => {
            if (!liveEraseQueue.isCurrent(generation)) return;
            if (liveEraseSession) {
                liveEraseSession.queueErase(batch, stickerToolSettings.contentEraserSize);
            } else {
                liveErasePendingPoints.push(...batch);
            }
        });

    const appendLiveErasePoint = (point: StickerPoint) => {
        const lastPoint = liveEraseStrokePoints[liveEraseStrokePoints.length - 1] || point;
        liveEraseStrokePoints.push(point);
        if (liveEraseQueue.isActive) {
            void applyLiveErase([lastPoint, point]);
        }
        return lastPoint;
    };

    const finishLiveErase = async (mode: LiveStickerEraseMode) => {
        if (!liveEraseQueue.isActive || liveEraseMode !== mode) return false;
        if (liveEraseInitialization) {
            await liveEraseInitialization;
        }
        const committed = await liveEraseQueue.finish();
        const session = liveEraseSession;
        if (!committed || !session || liveEraseMode !== mode) {
            resetLiveEraseRuntime();
            return false;
        }

        try {
            const result = session.finish();
            if (mode === "annotations") {
                if (!result.rasterizedAnnotationLayerSrc) return false;
                await options.patchUnitData({
                    rasterizedAnnotationLayerSrc: result.rasterizedAnnotationLayerSrc,
                    previewSrc: result.previewSrc,
                    resultHandle: undefined,
                    filePath: undefined,
                }, { propagateEdit: true });
            } else {
                await options.patchUnitData({
                    src: result.baseLayerSrc,
                    previewSrc: result.previewSrc,
                    resultHandle: undefined,
                    filePath: undefined,
                    rasterizedAnnotationLayerSrc: result.rasterizedAnnotationLayerSrc,
                    imageEditState: createEmptyImageEditState(),
                }, { propagateEdit: true });
            }
            return true;
        } finally {
            resetLiveEraseRuntime();
        }
    };

    const finishActiveLiveErase = async (): Promise<ActiveLiveEraseResult | null> => {
        if (!liveEraseQueue.isActive || !liveEraseMode) return null;
        const mode = liveEraseMode;
        return { mode, finished: await finishLiveErase(mode) };
    };

    onCleanup(() => {
        void liveEraseQueue.finish();
        resetLiveEraseRuntime();
    });

    return {
        appendLiveErasePoint,
        beginLiveContentErase: (point: StickerPoint) => beginLiveErase("content", point),
        beginLiveRasterizedAnnotationErase: (point: StickerPoint) => beginLiveErase("annotations", point),
        commitContentErase,
        finishActiveLiveErase,
        liveErasePreviewVisible,
        liveEraseStrokePoints: () => liveEraseStrokePoints,
        resetLiveEraseRuntime,
        setLiveErasePreviewRef: (element: HTMLCanvasElement) => {
            liveErasePreviewRef = element;
        },
    };
};
