import { expect, it } from "vitest";
import type { LiveCaptureStatus } from "../../src/services/liveCapture";
import type { LiveRelaySnapshot } from "../../src/services/liveRelay";
import type { LiveCaptureTiming, LiveRelaySourceTiming, LiveStageTiming } from "../../src/services/liveTiming";

const stage: LiveStageTiming = {
    attempts: 3, succeeded: 1, failed: 1, empty: 1, totalMicros: 60, maxMicros: 30,
};
const capture: LiveCaptureTiming = {
    cpuAdmission: { granted: 1, policyDenied: 2, lockUnavailable: 3 },
    readback: { stagingCopy: stage, mapRgb: stage },
    handoff: stage, jpegEncode: stage, frameStore: stage,
};
const source: LiveRelaySourceTiming = {
    socketService: stage, latestFrame: stage, adaptation: stage, socketSend: stage,
};

it("exposes all native timing fields through the declared IPC status contracts", () => {
    const captureStatus: Pick<LiveCaptureStatus, "captureTiming"> = { captureTiming: capture };
    const relayStatus: Pick<LiveRelaySnapshot, "sourceTiming"> = { sourceTiming: source };
    expect(captureStatus.captureTiming?.readback.mapRgb.totalMicros).toBe(60);
    expect(captureStatus.captureTiming?.cpuAdmission?.policyDenied).toBe(2);
    expect(relayStatus.sourceTiming?.socketSend.attempts).toBe(3);
    expect(Object.keys(stage)).toEqual(["attempts", "succeeded", "failed", "empty", "totalMicros", "maxMicros"]);
});

it("preserves absent legacy fields and unmeasured null instead of synthesizing zeroes", () => {
    const legacyCapture: Pick<LiveCaptureStatus, "captureTiming"> = {};
    const legacyRelay: Pick<LiveRelaySnapshot, "sourceTiming"> = {};
    const unmeasuredCapture: Pick<LiveCaptureStatus, "captureTiming"> = { captureTiming: null };
    const unmeasuredRelay: Pick<LiveRelaySnapshot, "sourceTiming"> = { sourceTiming: null };
    const noAdmission: LiveCaptureTiming = { ...capture, cpuAdmission: null };
    expect(legacyCapture.captureTiming).toBeUndefined();
    expect(legacyRelay.sourceTiming).toBeUndefined();
    expect(unmeasuredCapture.captureTiming).toBeNull();
    expect(unmeasuredRelay.sourceTiming).toBeNull();
    expect(noAdmission.cpuAdmission).toBeNull();
});
