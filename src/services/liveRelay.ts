import type { LiveCaptureInputPayload, LiveCaptureView } from "./liveCapture";
import type { LiveTriggerCondition } from "./liveProtocol";

export type LiveRelayConnectionState = "connecting" | "connected" | "recovering" | "closed";
export type LiveRelayObservationState =
    | "unknown"
    | "detected"
    | "observing"
    | "stable"
    | "triggered"
    | "stale"
    | "error";

export interface LiveRelayElementLocator {
    automationId?: string | null;
    name?: string | null;
    controlType: string;
    ancestorPath: string[];
    runtimeId?: number[] | null;
}

export interface LiveRelayObservation {
    observationId: string;
    sequence: number;
    state: LiveRelayObservationState;
    source: "ui_automation" | "app_adapter" | "vision" | "unknown";
    confidence: "exact" | "high" | "medium" | "low";
    observedAtMs: number;
    stableSinceMs?: number | null;
    locator?: LiveRelayElementLocator | null;
    value?: unknown;
    reason?: string | null;
}

export interface LiveRelayTriggerTarget {
    surfaceInstanceId: string;
    surfaceAttachmentId: string;
    surfaceNodeId: string;
    surfaceEvent: string;
    surfaceAction: string;
}

export interface LiveRelayTriggerRegistration {
    binding: {
        bindingId: string;
        observationId: string;
        conditionRevision: number;
        authorizedBy: string;
        enabled: boolean;
    };
    condition: LiveTriggerCondition;
    target: LiveRelayTriggerTarget;
    armed: boolean;
    lastMatch: boolean;
    pendingOfflineMatch: boolean;
}

export interface LiveRelayTriggerAudit {
    triggerId: string;
    bindingId: string;
    conditionRevision: number;
    observationId: string;
    observationSequence: number;
    sourceDeviceId: string;
    observationSource: LiveRelayObservation["source"];
    idempotencyKey: string;
    outcome: "fired" | "skipped" | "failed";
    evaluatedAtMs: number;
    authorizedBy: string;
    actionRequestId?: string | null;
    reason?: string | null;
}

export interface LiveRelayTriggerConfigureRequest {
    relayId: string;
    bindingId: string;
    enabled: boolean;
    target: LiveRelayTriggerTarget;
    condition: LiveTriggerCondition;
}

export interface LiveRelaySnapshot {
    relayId: string;
    liveSessionId: string;
    role: "source" | "viewer";
    captureSessionId?: string | null;
    connectionState: LiveRelayConnectionState;
    epoch: number;
    lastFrameId: number;
    receivedFrames: number;
    reconnectCount: number;
    overwrittenFrames: number;
    controllerOwned: boolean;
    remoteControlActive: boolean;
    lastInputSequence: number;
    lastConnectedAtMs?: number | null;
    lastFrameAtMs?: number | null;
    mediaTransport: "websocket_binary";
    networkScope: "loopback_http" | "loopback_https" | "private_https" | "unavailable";
    roundTripLatencyMs?: number | null;
    latencyState: "measuring" | "low" | "elevated" | "high" | "unavailable";
    observationCapabilities: string[];
    observationState: "unsupported" | "observing" | "stable" | "stale" | "error" | "closed";
    observationReason?: string | null;
    observations: LiveRelayObservation[];
    triggers: LiveRelayTriggerRegistration[];
    triggerAudits: LiveRelayTriggerAudit[];
    errorCode?: string | null;
    errorMessage?: string | null;
}

export interface LiveRelayFrameDescriptor {
    relayId: string;
    liveSessionId: string;
    epoch: number;
    frameId: number;
    captureTimestampMs: number;
    encodeTimestampMs: number;
    receivedTimestampMs: number;
    width: number;
    height: number;
    codec: "raw_bgra";
    colorSpace: "srgb";
    byteLength: number;
    droppedFrames: number;
}

export interface LiveRelayPollResponse {
    status: LiveRelaySnapshot;
    frame?: LiveRelayFrameDescriptor | null;
}

export interface LiveRelaySessionSummary {
    session: {
        sessionId: string;
        sourceDeviceId: string;
        sourceHookId: string;
        sourceKind: "window" | "region";
        sourceWindowIdentity: { title?: string | null };
        frameStream: { width: number; height: number; targetFps: number };
        interactionCapabilities: string[];
        observationCapabilities: string[];
        triggerBindings: Array<{
            bindingId: string;
            observationId: string;
            conditionRevision: number;
            authorizedBy: string;
            enabled: boolean;
        }>;
        viewerDevices: string[];
        controllerDevice?: string | null;
    };
    epoch: number;
    sourceConnected: boolean;
    closed: boolean;
}

export interface LiveRelayDiscovery {
    protocolVersion: "loom.live.v1";
    sessions: LiveRelaySessionSummary[];
}

export interface LiveRelayBinding {
    unitId: string;
    instanceId: string;
    attachmentId: string;
    label: string;
}

export interface LiveRelayView {
    relayId: string;
    status: LiveRelaySnapshot;
    title: string;
    imageUrl?: string;
    renderedFrameId: number;
    frameWidth: number;
    frameHeight: number;
    x: number;
    y: number;
    width: number;
    height: number;
    pinned: boolean;
    zIndex: number;
    controlError?: string;
}

export type LiveRelayInputPayload = LiveCaptureInputPayload;

export const relayGeometry = (
    source: { width: number; height: number },
    offset: number,
): Pick<LiveCaptureView, "x" | "y" | "width" | "height"> => {
    const ratio = Math.max(1, source.width) / Math.max(1, source.height);
    const width = Math.min(560, Math.max(320, source.width));
    const height = Math.min(420, Math.max(200, Math.round(width / ratio)));
    return { x: 48 + offset * 28, y: 92 + offset * 28, width, height };
};

export function encodeBgraAsBmp(bytes: Uint8Array, width: number, height: number): Uint8Array {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
        throw new Error("live relay frame dimensions are invalid");
    }
    const expected = width * height * 4;
    if (!Number.isSafeInteger(expected) || expected !== bytes.byteLength) {
        throw new Error("live relay BGRA byte length mismatch");
    }
    const headerLength = 54;
    const output = new Uint8Array(headerLength + expected);
    const view = new DataView(output.buffer);
    output.set([0x42, 0x4d]);
    view.setUint32(2, output.byteLength, true);
    view.setUint32(10, headerLength, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, -height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 32, true);
    view.setUint32(34, expected, true);
    output.set(bytes, headerLength);
    return output;
}
