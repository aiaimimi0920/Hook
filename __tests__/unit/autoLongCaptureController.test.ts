// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ManualLongCaptureFrame } from "../../src/services/captureState";

const state = vi.hoisted(() => ({
    setLongCaptureSession: vi.fn(),
    debugLogEvent: vi.fn(async () => undefined),
    setCaptureInputActive: vi.fn(async () => undefined),
    setMouseMonitorActive: vi.fn(async () => undefined),
    setOverlayClickThrough: vi.fn(async () => undefined),
    setOverlayCaptureExclusion: vi.fn(async () => undefined),
    startLongCaptureSession: vi.fn(),
    sampleLongCaptureSession: vi.fn(),
    finishLongCaptureSession: vi.fn(),
    cancelLongCaptureSession: vi.fn(async () => undefined),
    captureRegion: vi.fn(),
    analyzeLongCapturePair: vi.fn(),
    stitchLongCaptureFrames: vi.fn(),
}));

vi.mock("../../src/store/uiStore", () => ({
    setLongCaptureSession: state.setLongCaptureSession,
}));

vi.mock("../../src/services/api", () => ({
    api: {
        debugLogEvent: state.debugLogEvent,
        setCaptureInputActive: state.setCaptureInputActive,
        setMouseMonitorActive: state.setMouseMonitorActive,
        setOverlayClickThrough: state.setOverlayClickThrough,
        setOverlayCaptureExclusion: state.setOverlayCaptureExclusion,
        startLongCaptureSession: state.startLongCaptureSession,
        sampleLongCaptureSession: state.sampleLongCaptureSession,
        finishLongCaptureSession: state.finishLongCaptureSession,
        cancelLongCaptureSession: state.cancelLongCaptureSession,
        captureRegion: state.captureRegion,
        analyzeLongCapturePair: state.analyzeLongCapturePair,
        stitchLongCaptureFrames: state.stitchLongCaptureFrames,
    },
}));

import { createAutoLongCaptureController } from "../../src/hooks/autoLongCaptureController";

const frame: ManualLongCaptureFrame = {
    base64: "data:image/png;base64,AQID",
    width: 120,
    height: 80,
};

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const flushPromises = async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

describe("auto long capture controller", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        state.startLongCaptureSession.mockResolvedValue("backend-session");
        state.sampleLongCaptureSession.mockResolvedValue({
            frameCount: 1,
            duplicateCount: 0,
            axis: "vertical",
            direction: "down",
            status: "recorded",
            recorded: true,
        });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    const createController = () => {
        const dependencies = {
            resetSelection: vi.fn(),
            restorePostCaptureInteractivity: vi.fn(async () => undefined),
            addCaptureUnit: vi.fn(async () => undefined),
        };
        return {
            controller: createAutoLongCaptureController(dependencies),
            dependencies,
        };
    };

    it("coalesces concurrent finish requests into one backend finish and one sticker commit", async () => {
        const finish = deferred<ManualLongCaptureFrame>();
        state.finishLongCaptureSession.mockReturnValue(finish.promise);
        const { controller, dependencies } = createController();
        await controller.startAutoLongCaptureSession(
            { x: 10, y: 20, w: 120, h: 80 },
            { x: 10, y: 20 },
        );

        const first = controller.finishAutoLongCaptureSession();
        const second = controller.finishAutoLongCaptureSession();

        expect(second).toBe(first);
        await flushPromises();
        expect(state.finishLongCaptureSession).toHaveBeenCalledTimes(1);

        finish.resolve(frame);
        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
        expect(dependencies.addCaptureUnit).toHaveBeenCalledTimes(1);
        expect(dependencies.restorePostCaptureInteractivity).toHaveBeenCalledTimes(1);
    });

    it("waits for an in-flight finish teardown before starting the next session", async () => {
        const finish = deferred<ManualLongCaptureFrame>();
        state.finishLongCaptureSession.mockReturnValue(finish.promise);
        const { controller, dependencies } = createController();
        await controller.startAutoLongCaptureSession(
            { x: 0, y: 0, w: 100, h: 100 },
            { x: 0, y: 0 },
        );

        const finishing = controller.finishAutoLongCaptureSession();
        const nextStart = controller.startAutoLongCaptureSession(
            { x: 200, y: 100, w: 160, h: 90 },
            { x: 200, y: 100 },
        );
        await flushPromises();
        expect(state.startLongCaptureSession).toHaveBeenCalledTimes(1);

        finish.resolve(frame);
        await finishing;
        await nextStart;

        expect(state.startLongCaptureSession).toHaveBeenCalledTimes(2);
        expect(dependencies.restorePostCaptureInteractivity).toHaveBeenCalledTimes(1);
        expect(
            dependencies.restorePostCaptureInteractivity.mock.invocationCallOrder[0],
        ).toBeLessThan(state.startLongCaptureSession.mock.invocationCallOrder[1]);
    });
});
