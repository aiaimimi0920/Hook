import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Unit } from "../../src/types/unit";

const state = vi.hoisted(() => ({
    flipLayer: vi.fn(),
    flipEditData: vi.fn(),
    captureSnapshot: vi.fn(),
    pushHistory: vi.fn(),
    updateUnitData: vi.fn(),
    performWorkflowSync: vi.fn(),
}));

vi.mock("../../src/services/stickerBitmapLayers", () => ({
    flipRasterizedAnnotationLayer: state.flipLayer,
}));

vi.mock("../../src/services/stickerEditTransforms", () => ({
    flipStickerEditDataForFrame: state.flipEditData,
}));

vi.mock("../../src/services/stickerHistory", () => ({
    captureStickerEditSnapshot: state.captureSnapshot,
}));

vi.mock("../../src/services/stickerEditing", () => ({
    computeRestoredCropFrame: vi.fn(),
    scaleStickerFrame: vi.fn(),
    toggleStickerBorder: vi.fn(),
}));

vi.mock("../../src/store/graphStore", () => ({
    graphStore: {
        actions: {
            updateUnitData: state.updateUnitData,
            updateUnit: vi.fn(),
            resizeStickerFrame: vi.fn(),
        },
    },
}));

vi.mock("../../src/store/uiStore", () => ({
    stickerColorState: { activeColor: "#ffffff" },
    uiActions: { pushStickerHistory: state.pushHistory },
}));

vi.mock("../../src/services/syncService", () => ({
    syncService: { performWorkflowSync: state.performWorkflowSync },
}));

import { createPropertyBarCropController } from "../../src/components/stickerTopStripPropertyBarCropController";

const createUnit = (): Unit => ({
    id: "sticker-1",
    type: "sticker",
    x: 10,
    y: 20,
    w: 100,
    h: 80,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        src: "data:image/png;base64,source",
        rasterizedAnnotationLayerSrc: "data:image/png;base64,annotations",
        imageEditState: { contentEraseStrokes: [] },
    },
});

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const mountController = (unit: () => Unit | undefined) => {
    let dispose: () => void = () => undefined;
    let controller!: ReturnType<typeof createPropertyBarCropController>;
    createRoot((rootDispose) => {
        dispose = rootDispose;
        controller = createPropertyBarCropController({
            unitId: () => unit()?.id ?? "sticker-1",
            unit,
            pushCurrentStickerHistory: vi.fn(() => true),
        });
    });
    return { controller, dispose };
};

describe("property bar crop controller", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.flipEditData.mockReturnValue({ imageEditState: { contentEraseStrokes: [] } });
        state.captureSnapshot.mockReturnValue({ unitId: "sticker-1" });
        state.performWorkflowSync.mockResolvedValue(undefined);
    });

    it("discards a pending flip after the sticker edit state changes", async () => {
        const pending = deferred<string>();
        state.flipLayer.mockReturnValueOnce(pending.promise);
        let unit = createUnit();
        const { controller, dispose } = mountController(() => unit);
        const flip = controller.applyCropFlip("x");

        unit = { ...unit, data: { ...unit.data, imageEditState: { contentEraseStrokes: [], flippedX: true } } };
        pending.resolve("stale-layer");
        await flip;

        expect(state.pushHistory).not.toHaveBeenCalled();
        expect(state.updateUnitData).not.toHaveBeenCalled();
        expect(state.performWorkflowSync).not.toHaveBeenCalled();
        dispose();
    });

    it("runs one flip at a time and commits history, mutation, then sync", async () => {
        const pending = deferred<string>();
        state.flipLayer.mockReturnValueOnce(pending.promise);
        const unit = createUnit();
        const { controller, dispose } = mountController(() => unit);
        const first = controller.applyCropFlip("x");
        const second = controller.applyCropFlip("y");

        expect(state.flipLayer).toHaveBeenCalledOnce();
        pending.resolve("flipped-layer");
        await Promise.all([first, second]);

        expect(state.pushHistory).toHaveBeenCalledOnce();
        expect(state.updateUnitData).toHaveBeenCalledOnce();
        expect(state.performWorkflowSync).toHaveBeenCalledOnce();
        expect(state.pushHistory.mock.invocationCallOrder[0]).toBeLessThan(state.updateUnitData.mock.invocationCallOrder[0]);
        expect(state.updateUnitData.mock.invocationCallOrder[0]).toBeLessThan(state.performWorkflowSync.mock.invocationCallOrder[0]);
        dispose();
    });

    it("does not commit a pending flip after disposal", async () => {
        const pending = deferred<string>();
        state.flipLayer.mockReturnValueOnce(pending.promise);
        const unit = createUnit();
        const { controller, dispose } = mountController(() => unit);
        const flip = controller.applyCropFlip("x");

        dispose();
        pending.resolve("orphaned-layer");
        await flip;

        expect(state.pushHistory).not.toHaveBeenCalled();
        expect(state.updateUnitData).not.toHaveBeenCalled();
        expect(state.performWorkflowSync).not.toHaveBeenCalled();
    });
});
