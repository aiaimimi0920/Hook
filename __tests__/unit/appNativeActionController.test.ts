// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OverlaySyntheticDispatcher } from "../../src/services/overlaySyntheticEvents";

const state = vi.hoisted(() => ({
    selecting: false,
    units: [] as object[],
    getCaptureCursorPosition: vi.fn(),
    setMouseMonitorActive: vi.fn(),
    setCaptureInputActive: vi.fn(),
    setOverlayClickThrough: vi.fn(),
    debugLogEvent: vi.fn(),
    updateBackendRects: vi.fn(),
    setCaptureMode: vi.fn(),
    setMousePos: vi.fn(),
}));

vi.mock("../../src/store/uiStore", () => ({
    isSelecting: () => state.selecting,
    setIsSelecting: (value: boolean) => {
        state.selecting = value;
    },
    longCaptureSession: () => null,
    selectedStickerId: () => null,
    setCaptureMode: state.setCaptureMode,
    setMousePos: state.setMousePos,
}));

vi.mock("../../src/store/graphStore", () => ({
    graphStore: {
        get units() {
            return state.units;
        },
    },
}));

vi.mock("../../src/services/api", () => ({
    api: {
        getCaptureCursorPosition: state.getCaptureCursorPosition,
        setMouseMonitorActive: state.setMouseMonitorActive,
        setCaptureInputActive: state.setCaptureInputActive,
        setOverlayClickThrough: state.setOverlayClickThrough,
        debugLogEvent: state.debugLogEvent,
    },
}));

vi.mock("../../src/services/editableFocus", () => ({
    hasActiveEditableShortcutTarget: () => false,
    hasFocusedDomShortcutOwner: () => false,
}));

vi.mock("../../src/services/syncService", () => ({
    syncService: { updateBackendRects: state.updateBackendRects },
}));

import { createAppNativeActionController } from "../../src/services/appNativeActionController";

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<undefined>((resolvePromise) => {
        resolve = () => resolvePromise(undefined);
    });
    return { promise, resolve };
};

const flushPromises = async () => {
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
};

describe("app native capture action controller", () => {
    beforeEach(() => {
        state.selecting = false;
        state.units = [{}];
        for (const mock of [
            state.getCaptureCursorPosition,
            state.setMouseMonitorActive,
            state.setCaptureInputActive,
            state.setOverlayClickThrough,
            state.debugLogEvent,
            state.updateBackendRects,
            state.setCaptureMode,
            state.setMousePos,
        ]) mock.mockReset();
        state.getCaptureCursorPosition.mockResolvedValue({ x: 12, y: 34 });
        state.setMouseMonitorActive.mockResolvedValue(undefined);
        state.setCaptureInputActive.mockResolvedValue(undefined);
        state.setOverlayClickThrough.mockResolvedValue(undefined);
        state.debugLogEvent.mockResolvedValue(undefined);
        state.updateBackendRects.mockResolvedValue(undefined);
    });

    const createController = () => {
        const overlaySynthetic: OverlaySyntheticDispatcher = {
            dispatch: vi.fn(),
            relayPointerMove: vi.fn(),
            clearHover: vi.fn(),
            reset: vi.fn(),
            moveRelayActive: false,
        };
        const dependencies = {
            activeBootProfile: () => null,
            appSettingsOpen: () => false,
            setAppSettingsOpen: vi.fn(),
            surfaceConfirmationCount: () => 0,
            rejectCurrentSurfaceConfirmation: vi.fn(async () => undefined),
            captureInput: {
                nativePointerActive: false,
                ctrlReleasedSinceCaptureStart: false,
            },
            overlaySynthetic,
            beginCaptureSessionLifecycle: vi.fn(),
            invalidateCaptureSessionLifecycle: vi.fn(),
            resetSelection: vi.fn(() => {
                state.selecting = false;
            }),
            prepareCaptureWindowTargets: vi.fn(async () => undefined),
            cancelAutoLongCaptureSession: vi.fn(async () => false),
            closeSelectedActionsMenu: vi.fn(() => false),
            deleteSelectedUnitOrAnnotation: vi.fn(),
        };
        return { controller: createAppNativeActionController(dependencies), dependencies };
    };

    it("rolls back every capture input boundary when activation fails", async () => {
        const { controller, dependencies } = createController();
        state.setOverlayClickThrough.mockRejectedValueOnce(new Error("activation failed"));

        await expect(controller.beginCaptureSelection("region")).rejects.toThrow("activation failed");

        expect(state.selecting).toBe(false);
        expect(dependencies.invalidateCaptureSessionLifecycle).toHaveBeenCalledTimes(1);
        expect(dependencies.overlaySynthetic.clearHover).toHaveBeenCalledTimes(1);
        expect(state.setCaptureInputActive.mock.calls.map(([active]) => active)).toEqual([true, false]);
        expect(state.setMouseMonitorActive.mock.calls.map(([active]) => active)).toEqual([false, true]);
        expect(state.updateBackendRects).toHaveBeenCalledTimes(1);
    });

    it("does not let slow target discovery block activation or re-enable input after abort", async () => {
        const pendingPreparation = deferred();
        const { controller, dependencies } = createController();
        dependencies.prepareCaptureWindowTargets.mockReturnValue(pendingPreparation.promise);

        const activation = controller.beginCaptureSelection("region");
        await flushPromises();
        expect(state.setCaptureInputActive).toHaveBeenCalledWith(true);
        const abort = controller.abortCaptureSelection("unpaired-up");
        await abort;
        pendingPreparation.resolve();

        await activation;
        expect(state.setCaptureInputActive.mock.calls.map(([active]) => active)).toEqual([true, false]);
        expect(state.setCaptureInputActive).toHaveBeenLastCalledWith(false);
        expect(state.selecting).toBe(false);
    });

    it("does not start a new capture until stale native activation has released input", async () => {
        const pendingInputActivation = deferred();
        state.setCaptureInputActive.mockImplementationOnce(() => pendingInputActivation.promise);
        const { controller } = createController();

        const firstActivation = controller.beginCaptureSelection("region");
        await flushPromises();
        const abort = controller.abortCaptureSelection("escape");
        await flushPromises();
        await controller.beginCaptureSelection("region");

        expect(state.setCaptureInputActive.mock.calls.filter(([active]) => active)).toHaveLength(1);
        pendingInputActivation.resolve();
        await Promise.all([firstActivation, abort]);
        expect(state.setCaptureInputActive).toHaveBeenLastCalledWith(false);

        await controller.beginCaptureSelection("region");
        expect(state.setCaptureInputActive.mock.calls.filter(([active]) => active)).toHaveLength(2);
    });

    it("continues cleanup after native input disable rejects", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { controller, dependencies } = createController();
        await controller.beginCaptureSelection("region");
        state.setCaptureInputActive.mockRejectedValueOnce(new Error("disable failed"));

        await controller.abortCaptureSelection("test-cleanup");

        expect(dependencies.overlaySynthetic.clearHover).toHaveBeenCalledTimes(1);
        expect(dependencies.resetSelection).toHaveBeenCalledTimes(2);
        expect(state.setOverlayClickThrough).toHaveBeenLastCalledWith(true);
        expect(state.setMouseMonitorActive).toHaveBeenLastCalledWith(true);
        expect(state.updateBackendRects).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });
});
