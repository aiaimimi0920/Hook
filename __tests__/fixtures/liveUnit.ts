import type { LiveCaptureStatus } from "../../src/services/liveCapture";

export const liveUnitStatus = (): LiveCaptureStatus => ({
    sessionId: "live-runtime-test",
    sourceKind: "window",
    sourceWindowId: "1234",
    sourceTitle: "Fixture",
    sourceProcessId: 123,
    captureState: "streaming",
    visibilityState: "visible",
    targetFps: 12,
    maxBufferedFrames: 3,
    epoch: 1,
    frameId: 1,
    width: 200,
    height: 100,
    droppedFrames: 0,
    createdAtMs: 1,
    sourceWindowState: "visible",
    inputCapability: "window_message",
    interactionEnabled: true,
});
