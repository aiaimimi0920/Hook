import { createSignal, onCleanup, type Accessor } from "solid-js";

import { graphStore } from "../store/graphStore";
import { flipRasterizedAnnotationLayer } from "../services/stickerBitmapLayers";
import {
    computeRestoredCropFrame,
    scaleStickerFrame,
    toggleStickerBorder,
} from "../services/stickerEditing";
import { flipStickerEditDataForFrame } from "../services/stickerEditTransforms";
import { captureStickerEditSnapshot } from "../services/stickerHistory";
import {
    createStickerAsyncEditGuard,
    isStickerAsyncEditGuardCurrent,
} from "../services/stickerAsyncEditGuard";
import { createSingleFlightAction } from "../services/singleFlightAction";
import { syncStickerEditAfterLocalCommit } from "../services/stickerTopStripSync";
import { syncService } from "../services/syncService";
import { stickerColorState, uiActions } from "../store/uiStore";
import type { Unit } from "../types/unit";
import { parseCanvasStepperValue } from "./stickerTopStripPropertyBarNumeric";

interface CreatePropertyBarCropControllerOptions {
    unitId: Accessor<string>;
    unit: Accessor<Unit | undefined>;
    pushCurrentStickerHistory: (includeImageData?: boolean) => boolean;
}

/** Owns crop/frame drafts and preserves history -> mutation -> sync ordering. */
export const createPropertyBarCropController = (options: CreatePropertyBarCropControllerOptions) => {
    const [cropOpacityDraft, setCropOpacityDraft] = createSignal<string | null>(null);
    const [cropCanvasWidthDraft, setCropCanvasWidthDraft] = createSignal<string | null>(null);
    const [cropCornerRadiusDraft, setCropCornerRadiusDraft] = createSignal<string | null>(null);
    const cropFlipGate = createSingleFlightAction();
    let disposed = false;

    const getEditableOpacity = () =>
        options.unit()?.data.minified
            ? (options.unit()?.data.opacityMini ?? 0.9)
            : (options.unit()?.data.opacityNormal ?? 1);
    const getEditableOpacityPercent = () => Math.round(getEditableOpacity() * 100);
    const getEditableCanvasWidth = () => Math.max(32, Math.round(options.unit()?.w ?? 0));
    const getEditableFrameCornerRadius = () =>
        Math.max(0, Math.round(options.unit()?.data.imageEditState?.cornerRadius || 0));

    const applyCropFlip = async (axis: "x" | "y") => {
        try {
            await cropFlipGate.run(async () => {
                const currentUnit = options.unit();
                if (!currentUnit) return;

                const requestGuard = createStickerAsyncEditGuard(currentUnit);
                const historySnapshot = captureStickerEditSnapshot(currentUnit, { includeImageData: true });
                const current = currentUnit.data.imageEditState || { contentEraseStrokes: [] };
                const flipped = flipStickerEditDataForFrame(currentUnit.data, currentUnit, axis);
                const rasterizedAnnotationLayerSrc = currentUnit.data.rasterizedAnnotationLayerSrc
                    ? await flipRasterizedAnnotationLayer({
                          rasterizedAnnotationLayerSrc: currentUnit.data.rasterizedAnnotationLayerSrc,
                          size: { w: currentUnit.w, h: currentUnit.h },
                          axis,
                      })
                    : undefined;

                if (disposed || !isStickerAsyncEditGuardCurrent(requestGuard, options.unit())) return;
                uiActions.pushStickerHistory(options.unitId(), historySnapshot);
                graphStore.actions.updateUnitData(options.unitId(), {
                    ...flipped,
                    previewSrc: undefined,
                    rasterizedAnnotationLayerSrc,
                    imageEditState: {
                        ...(flipped.imageEditState || current),
                        flippedX: axis === "x" ? !current.flippedX : current.flippedX,
                        flippedY: axis === "y" ? !current.flippedY : current.flippedY,
                    },
                });
                await syncService.performWorkflowSync();
            });
        } catch (error) {
            console.error("[Hook] Failed to flip sticker crop content", error);
        }
    };

    onCleanup(() => {
        disposed = true;
        cropFlipGate.dispose();
    });

    const resetCrop = () => {
        const currentUnit = options.unit();
        if (!currentUnit) return;
        if (!options.pushCurrentStickerHistory()) return;

        const restored = computeRestoredCropFrame(
            { x: currentUnit.x, y: currentUnit.y, w: currentUnit.w, h: currentUnit.h },
            currentUnit.data.imageEditState,
        );
        graphStore.actions.updateUnit(options.unitId(), restored);
        graphStore.actions.updateUnitData(options.unitId(), {
            imageEditState: {
                ...(currentUnit.data.imageEditState || { contentEraseStrokes: [] }),
                cropRect: undefined,
            },
        });
        syncStickerEditAfterLocalCommit();
    };

    const updateStickerOpacityValue = (next: number) => {
        const currentUnit = options.unit();
        if (!currentUnit) return;
        if (!options.pushCurrentStickerHistory()) return;
        const clamped = Math.min(1, Math.max(0, next));
        if (currentUnit.data.minified) {
            graphStore.actions.updateUnitData(options.unitId(), { opacityMini: clamped });
        } else {
            graphStore.actions.updateUnitData(options.unitId(), { opacityNormal: clamped });
        }
        syncStickerEditAfterLocalCommit();
    };

    const scaleStickerCanvas = (factor: number) => {
        const currentUnit = options.unit();
        if (!currentUnit || !Number.isFinite(factor) || factor <= 0) return;
        if (!options.pushCurrentStickerHistory()) return;
        graphStore.actions.resizeStickerFrame(
            options.unitId(),
            scaleStickerFrame(
                { x: currentUnit.x, y: currentUnit.y, w: currentUnit.w, h: currentUnit.h },
                factor,
            ),
        );
        syncStickerEditAfterLocalCommit();
    };

    const updateStickerFrameCornerRadiusValue = (next: number) => {
        const currentUnit = options.unit();
        if (!currentUnit) return;
        if (!options.pushCurrentStickerHistory()) return;
        const current = currentUnit.data.imageEditState || { contentEraseStrokes: [] };
        const clamped = Math.min(128, Math.max(0, Math.round(next)));
        graphStore.actions.updateUnitData(options.unitId(), {
            imageEditState: { ...current, cornerRadius: clamped },
        });
        syncStickerEditAfterLocalCommit();
    };

    const commitCropOpacityDraft = () => {
        const fallback = getEditableOpacityPercent();
        const nextPercent = parseCanvasStepperValue(cropOpacityDraft(), fallback, 0, 100);
        setCropOpacityDraft(null);
        if (nextPercent === fallback) return;
        updateStickerOpacityValue(nextPercent / 100);
    };

    const commitCropCanvasWidthDraft = () => {
        const currentUnit = options.unit();
        if (!currentUnit) {
            setCropCanvasWidthDraft(null);
            return;
        }
        const fallback = getEditableCanvasWidth();
        const nextWidth = parseCanvasStepperValue(cropCanvasWidthDraft(), fallback, 32, 8192);
        setCropCanvasWidthDraft(null);
        if (nextWidth === fallback) return;
        scaleStickerCanvas(nextWidth / Math.max(currentUnit.w, 1));
    };

    const commitCropCornerRadiusDraft = () => {
        const fallback = getEditableFrameCornerRadius();
        const nextRadius = parseCanvasStepperValue(cropCornerRadiusDraft(), fallback, 0, 128);
        setCropCornerRadiusDraft(null);
        if (nextRadius === fallback) return;
        updateStickerFrameCornerRadiusValue(nextRadius);
    };

    const toggleCropBorder = () => {
        const currentUnit = options.unit();
        if (!currentUnit) return;
        if (!options.pushCurrentStickerHistory()) return;
        const current = currentUnit.data.imageEditState || { contentEraseStrokes: [] };
        graphStore.actions.updateUnitData(options.unitId(), {
            imageEditState: toggleStickerBorder(current, stickerColorState.activeColor),
        });
        syncStickerEditAfterLocalCommit();
    };

    return {
        cropOpacityDraft,
        setCropOpacityDraft,
        cropCanvasWidthDraft,
        setCropCanvasWidthDraft,
        cropCornerRadiusDraft,
        setCropCornerRadiusDraft,
        isCropBorderEnabled: () => !!((options.unit()?.data.imageEditState?.borderWidth || 0) > 0),
        getEditableOpacityPercent,
        getEditableCanvasWidth,
        getEditableFrameCornerRadius,
        applyCropFlip,
        resetCrop,
        commitCropOpacityDraft,
        commitCropCanvasWidthDraft,
        commitCropCornerRadiusDraft,
        toggleCropBorder,
    };
};
