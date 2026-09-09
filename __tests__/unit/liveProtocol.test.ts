import { describe, expect, it } from "vitest";

import { decodeLiveBinaryFrame, encodeLiveBinaryFrame } from "../../src/services/liveBinaryFrame";
import {
  LIVE_PROTOCOL_VERSION,
  hookLiveContractCapabilities,
  type LiveControlEnvelope,
  type LiveScreenshotSession,
} from "../../src/services/liveProtocol";
import { parseLiveControlEnvelope } from "../../src/services/liveProtocolValidation";
import { LiveSequenceTracker } from "../../src/services/liveSequenceTracker";

function session(): LiveScreenshotSession {
  return {
    protocolVersion: LIVE_PROTOCOL_VERSION,
    sessionId: "live-session-1",
    sourceDeviceId: "device-a",
    sourceHookId: "hook-a",
    sourceKind: "window",
    sourceWindowIdentity: { windowId: "0x1234", processId: 42 },
    sourceRegion: { x: 0, y: 0, width: 640, height: 360 },
    regionAnchor: "window",
    frameStream: {
      streamId: "stream-1",
      transport: "websocket_binary",
      endpoint: "wss://127.0.0.1/v1/live/media",
      codec: "h264",
      colorSpace: "srgb",
      width: 640,
      height: 360,
      targetFps: 30,
      maxBufferedFrames: 3,
      keyframeInterval: 60,
    },
    interactionCapabilities: ["pointer_move", "pointer_button"],
    observationCapabilities: ["uia_tree"],
    triggerBindings: [],
    viewerDevices: ["device-b"],
    visibilityState: "visible",
    captureStrategy: "persistent_window_wgc",
    renderPreservationStrategy: "visible_offscreen",
    revision: 1,
    createdAtMs: 2_000,
    lastSeenAtMs: 2_000,
  };
}

function startEnvelope(): Extract<LiveControlEnvelope, { messageType: "session_start" }> {
  return {
    protocolVersion: LIVE_PROTOCOL_VERSION,
    sessionId: "live-session-1",
    epoch: 1,
    sequence: 1,
    messageType: "session_start",
    payload: { session: session(), requestedByDeviceId: "device-a", requestNonce: "nonce-1" },
  };
}

describe("loom.live.v1 control contract", () => {
  it("accepts a strict source session and keeps runtime availability unclaimed", () => {
    expect(parseLiveControlEnvelope(startEnvelope())).toEqual(startEnvelope());
    expect(hookLiveContractCapabilities).toMatchObject({
      protocolVersion: "loom.live.v1",
      status: "contract_only",
      roles: ["source", "viewer"],
    });
  });

  it("rejects unknown top-level fields, message types, and versions", () => {
    expect(() => parseLiveControlEnvelope({ ...startEnvelope(), unexpected: true })).toThrow(/fields/);
    expect(() => parseLiveControlEnvelope({ ...startEnvelope(), messageType: "future_message" })).toThrow(
      /message type/,
    );
    expect(() => parseLiveControlEnvelope({ ...startEnvelope(), protocolVersion: "loom.live.v0" })).toThrow(
      /protocol version/,
    );
  });

  it("rejects unknown payload fields and buffers above the three-frame bound", () => {
    const ack = {
      protocolVersion: LIVE_PROTOCOL_VERSION,
      sessionId: "live-session-1",
      epoch: 1,
      sequence: 2,
      messageType: "session_ack",
      payload: { accepted: true, responderDeviceId: "device-b", future: true },
    };
    expect(() => parseLiveControlEnvelope(ack)).toThrow(/fields/);
    const invalid = startEnvelope();
    invalid.payload.session.frameStream.maxBufferedFrames = 4;
    expect(() => parseLiveControlEnvelope(invalid)).toThrow(/buffer bound/);
    invalid.payload.session.frameStream.maxBufferedFrames = 3;
    invalid.payload.session.triggerBindings = Array.from({ length: 65 }, (_, index) => ({
      bindingId: `binding-${index}`,
      observationId: `observation-${index}`,
      conditionRevision: 1,
      authorizedBy: "device-b",
      enabled: true,
    }));
    expect(() => parseLiveControlEnvelope(invalid)).toThrow(/too many triggerBindings/);
  });

  it("rejects invalid nested enums and malformed input payloads", () => {
    expect(() => parseLiveControlEnvelope({
      ...startEnvelope(),
      payload: { ...startEnvelope().payload, session: { ...session(), sourceKind: "future" } },
    })).toThrow(/sourceKind/);
    expect(() => parseLiveControlEnvelope({
      protocolVersion: LIVE_PROTOCOL_VERSION,
      sessionId: "live-session-1",
      epoch: 1,
      sequence: 2,
      messageType: "input_event",
      payload: {
        inputSequence: 1,
        issuedAtMs: 10,
        sourceDeviceId: "device-b",
        kind: { kind: "mouse_button", data: { button: "future", state: "pressed", x: 1, y: 2, clickCount: 1 } },
      },
    })).toThrow(/button/);
  });

  it("prevents unknown observations from carrying authoritative values", () => {
    const observation = {
      protocolVersion: LIVE_PROTOCOL_VERSION,
      sessionId: "live-session-1",
      epoch: 1,
      sequence: 2,
      messageType: "observation",
      payload: {
        observationId: "progress-1",
        sequence: 1,
        state: "unknown",
        source: "unknown",
        confidence: "low",
        observedAtMs: 10,
        value: 100,
      },
    };
    expect(() => parseLiveControlEnvelope(observation)).toThrow(/untrusted observation/);
  });

  it("prevents visual observations from claiming exact confidence", () => {
    const observation = {
      protocolVersion: LIVE_PROTOCOL_VERSION,
      sessionId: "live-session-1",
      epoch: 1,
      sequence: 2,
      messageType: "observation",
      payload: {
        observationId: "vision:progress-1",
        sequence: 1,
        state: "stable",
        source: "vision",
        confidence: "exact",
        observedAtMs: 10,
        stableSinceMs: 10,
        value: 100,
      },
    };
    expect(() => parseLiveControlEnvelope(observation)).toThrow(/visual source/);
    expect(parseLiveControlEnvelope({
      ...observation,
      payload: { ...observation.payload, confidence: "high" },
    })).toMatchObject({ payload: { confidence: "high" } });
  });

  it("requires element provenance for exact UI Automation observations", () => {
    const observation = {
      protocolVersion: LIVE_PROTOCOL_VERSION,
      sessionId: "live-session-1",
      epoch: 1,
      sequence: 2,
      messageType: "observation",
      payload: {
        observationId: "uia:progress-1",
        sequence: 1,
        state: "stable",
        source: "ui_automation",
        confidence: "exact",
        observedAtMs: 10,
        value: 100,
      },
    };
    expect(() => parseLiveControlEnvelope(observation)).toThrow(/requires a locator/);
  });

  it("bounds trigger selector types and nested operand shape", () => {
    const trigger = {
      protocolVersion: LIVE_PROTOCOL_VERSION,
      sessionId: "live-session-1",
      epoch: 1,
      sequence: 2,
      messageType: "trigger_condition",
      payload: {
        conditionId: "condition:progress",
        revision: 1,
        observationId: "uia:progress",
        operator: "greater_or_equal",
        operand: { path: "/rangeValue/value", value: 100 },
        stableForMs: 1_000,
        risingEdge: true,
        rearm: true,
        minimumConfidence: "exact",
      },
    };
    expect(parseLiveControlEnvelope(trigger)).toEqual(trigger);
    expect(() => parseLiveControlEnvelope({
      ...trigger,
      payload: { ...trigger.payload, operand: { path: "/rangeValue/value", value: "100" } },
    })).toThrow(/finite operand/);
    const deep = Array.from({ length: 17 }).reduce<unknown>((value) => ({ nested: value }), 1);
    expect(() => parseLiveControlEnvelope({
      ...trigger,
      payload: { ...trigger.payload, operator: "equals", operand: deep },
    })).toThrow(/operand shape/);
  });
});

describe("loom.live.v1 binary and sequence contract", () => {
  it("round-trips the fixed binary header without a JSON frame payload", () => {
    const frame = {
      epoch: 7n,
      frameId: 11n,
      captureTimestampMs: 10_000n,
      encodeTimestampMs: 10_004n,
      width: 640,
      height: 360,
      keyframe: true,
      droppedFrames: 2,
      colorSpace: "srgb" as const,
      codec: "h264" as const,
      payload: new Uint8Array([1, 2, 3, 4]),
    };
    expect(decodeLiveBinaryFrame(encodeLiveBinaryFrame(frame))).toEqual(frame);
  });

  it("rejects truncated, mismatched, and unsupported binary frames", () => {
    expect(() => decodeLiveBinaryFrame(new Uint8Array(12))).toThrow(/truncated/);
    const encoded = encodeLiveBinaryFrame({
      epoch: 1n,
      frameId: 1n,
      captureTimestampMs: 1n,
      encodeTimestampMs: 2n,
      width: 2,
      height: 2,
      keyframe: false,
      droppedFrames: 0,
      colorSpace: "srgb",
      codec: "raw_bgra",
      payload: new Uint8Array([1]),
    });
    encoded[55] = 2;
    expect(() => decodeLiveBinaryFrame(encoded)).toThrow(/length mismatch/);
    encoded[4] = 9;
    expect(() => decodeLiveBinaryFrame(encoded)).toThrow(/binary version/);
  });

  it("rejects unknown binary flag bits", () => {
    const encoded = encodeLiveBinaryFrame({
      epoch: 1n,
      frameId: 1n,
      captureTimestampMs: 1n,
      encodeTimestampMs: 2n,
      width: 2,
      height: 2,
      keyframe: false,
      droppedFrames: 0,
      colorSpace: "srgb",
      codec: "raw_bgra",
      payload: new Uint8Array([1]),
    });
    encoded[5] = 2;
    expect(() => decodeLiveBinaryFrame(encoded)).toThrow(/flags/);
  });

  it("orders control and input edges exactly while allowing frame gaps", () => {
    const tracker = new LiveSequenceTracker(4);
    tracker.acceptControl(4, 1);
    expect(() => tracker.acceptControl(4, 3)).toThrow(/expected 2/);
    tracker.acceptInput(4, 1);
    expect(() => tracker.acceptInput(4, 3)).toThrow(/expected 2/);
    expect(tracker.acceptFrame(4, 1)).toBe(0);
    expect(tracker.acceptFrame(4, 4)).toBe(2);
    expect(() => tracker.acceptFrame(4, 4)).toThrow(/stale frame/);
    tracker.resume(5, 9, 20, 3);
    tracker.acceptControl(5, 10);
  });

  it("rejects unsafe sequence numbers before arithmetic", () => {
    const tracker = new LiveSequenceTracker(4);
    expect(() => tracker.acceptControl(4, Number.MAX_SAFE_INTEGER + 1)).toThrow(/sequence/);
    expect(() => tracker.acceptInput(4, Number.MAX_SAFE_INTEGER + 1)).toThrow(/sequence/);
  });
});
