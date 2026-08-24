import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Unit } from "../../src/types/unit";

const state = vi.hoisted(() => ({
    units: [] as Unit[],
    renderBase: vi.fn(),
    renderAnnotations: vi.fn(),
    composePreview: vi.fn(),
    pushHistory: vi.fn(),
    updateUnitData: vi.fn(),
    performWorkflowSync: vi.fn(),
}));

vi.mock("../../src/store/graphStore", () => ({
    graphStore: {
        units: state.units,
        actions: { updateUnitData: state.updateUnitData },
    },
}));

vi.mock("../../src/store/uiStore", () => ({
    uiActions: { pushStickerHistory: state.pushHistory },
}));

vi.mock("../../src/services/stickerExport", () => ({
    renderStickerBaseLayer: state.renderBase,
    renderStickerTransparentAnnotationLayer: state.renderAnnotations,
}));

vi.mock("../../src/services/stickerBitmapLayers", () => ({
    composeRasterizedStickerPreview: state.composePreview,
}));

vi.mock("../../src/services/syncService", () => ({
    syncService: { performWorkflowSync: state.performWorkflowSync },
}));

import { rasterizeStickerAnnotationsForUnit } from "../../src/services/stickerRasterizeActions";

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
        annotationState: {
            elements: [{
                id: "annotation-1",
                type: "rect",
                zIndex: 0,
                x: 1,
                y: 2,
                w: 10,
                h: 12,
                style: {
                    color: "#ffffff",
                    fill: "#000000",
                    width: 1,
                },
            }],
            serialCounter: 0,
        },
    },
});

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
};

const runRasterize = (unit: Unit) =>
    rasterizeStickerAnnotationsForUnit({
        unitId: unit.id,
        currentUnit: unit,
        scope: "selected",
        selectedAnnotationId: "annotation-1",
    });

describe("sticker rasterize actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.units.splice(0, state.units.length, createUnit());
        state.renderBase.mockResolvedValue("base-layer");
        state.renderAnnotations.mockResolvedValue("annotation-layer");
        state.composePreview.mockResolvedValue("preview");
        state.performWorkflowSync.mockResolvedValue(undefined);
    });

    it("commits history, bitmap data, and workflow sync in order for a current request", async () => {
        await expect(runRasterize(state.units[0])).resolves.toBe(true);

        expect(state.pushHistory).toHaveBeenCalledOnce();
        expect(state.updateUnitData).toHaveBeenCalledOnce();
        expect(state.performWorkflowSync).toHaveBeenCalledOnce();
        expect(state.pushHistory.mock.invocationCallOrder[0]).toBeLessThan(
            state.updateUnitData.mock.invocationCallOrder[0],
        );
        expect(state.updateUnitData.mock.invocationCallOrder[0]).toBeLessThan(
            state.performWorkflowSync.mock.invocationCallOrder[0],
        );
    });

    it("discards rendered output when the unit changes while image work is pending", async () => {
        const baseResult = deferred<string>();
        state.renderBase.mockReturnValueOnce(baseResult.promise);
        const originalUnit = state.units[0];
        const run = runRasterize(originalUnit);

        state.units[0] = {
            ...originalUnit,
            data: {
                ...originalUnit.data,
                annotationState: { elements: [], serialCounter: 0 },
            },
        };
        baseResult.resolve("stale-base-layer");

        await expect(run).resolves.toBe(false);
        expect(state.pushHistory).not.toHaveBeenCalled();
        expect(state.updateUnitData).not.toHaveBeenCalled();
        expect(state.performWorkflowSync).not.toHaveBeenCalled();
    });

    it("discards rendered output after the target unit is deleted", async () => {
        const baseResult = deferred<string>();
        state.renderBase.mockReturnValueOnce(baseResult.promise);
        const run = runRasterize(state.units[0]);

        state.units.splice(0, state.units.length);
        baseResult.resolve("orphaned-base-layer");

        await expect(run).resolves.toBe(false);
        expect(state.updateUnitData).not.toHaveBeenCalled();
        expect(state.performWorkflowSync).not.toHaveBeenCalled();
    });

    it("reports a local commit when backend sync fails after the graph mutation", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        state.performWorkflowSync.mockRejectedValueOnce(new Error("sync failed"));

        await expect(runRasterize(state.units[0])).resolves.toBe(true);
        expect(state.pushHistory).toHaveBeenCalledOnce();
        expect(state.updateUnitData).toHaveBeenCalledOnce();
        expect(consoleError).toHaveBeenCalledWith(
            "Rasterize sticker annotations failed",
            expect.objectContaining({ message: "sync failed" }),
        );
        consoleError.mockRestore();
    });
});
