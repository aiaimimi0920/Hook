export const LIVE_PROTOCOL_VERSION = "loom.live.v1" as const;
export const LIVE_BINARY_VERSION = 1 as const;
export const LIVE_MAX_DIMENSION = 16_384;
export const LIVE_MAX_FRAME_PAYLOAD = 64 * 1024 * 1024;

export type LiveDeviceRole = "source" | "viewer" | "controller";
export type LiveRegionAnchor = "window" | "control" | "screen";
export type LiveSourceKind = "window" | "display" | "region";
export type LiveMediaTransport = "websocket_binary" | "shared_memory" | "cloud_relay";
export type LiveCodec = "raw_bgra" | "h264";
export type LiveColorSpace = "srgb" | "hdr10";
export type LiveVisibilityState =
  | "visible"
  | "unfocused"
  | "logical_minimized"
  | "logical_hidden"
  | "restoring"
  | "capture_recovering"
  | "capture_failed"
  | "closed";
export type LiveCaptureStrategy = "persistent_window_wgc" | "persistent_display_wgc" | "adapter";
export type LiveRenderPreservationStrategy =
  | "visible"
  | "visible_offscreen"
  | "hidden_workspace"
  | "application_adapter"
  | "unsupported";
export type LiveInteractionCapability =
  | "pointer_move"
  | "pointer_button"
  | "double_click"
  | "drag"
  | "wheel"
  | "keyboard"
  | "text"
  | "focus"
  | "cancel";
export type LiveObservationCapability =
  | "uia_tree"
  | "invoke"
  | "range_value"
  | "value"
  | "toggle"
  | "scroll"
  | "adapter"
  | "vision";

export interface LiveRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LiveWindowIdentity {
  windowId: string;
  processId: number;
  processStartedAtMs?: number;
  title?: string;
}

export interface LiveFrameStreamDescriptor {
  streamId: string;
  transport: LiveMediaTransport;
  endpoint?: string;
  codec: LiveCodec;
  colorSpace: LiveColorSpace;
  width: number;
  height: number;
  targetFps: number;
  maxBufferedFrames: number;
  keyframeInterval: number;
}

export interface LiveTriggerBinding {
  bindingId: string;
  observationId: string;
  conditionRevision: number;
  authorizedBy: string;
  enabled: boolean;
}

export interface LiveScreenshotSession {
  protocolVersion: typeof LIVE_PROTOCOL_VERSION;
  sessionId: string;
  sourceDeviceId: string;
  sourceHookId: string;
  sourceKind: LiveSourceKind;
  sourceWindowIdentity: LiveWindowIdentity;
  sourceRegion: LiveRect;
  regionAnchor: LiveRegionAnchor;
  frameStream: LiveFrameStreamDescriptor;
  interactionCapabilities: LiveInteractionCapability[];
  observationCapabilities: LiveObservationCapability[];
  triggerBindings: LiveTriggerBinding[];
  viewerDevices: string[];
  controllerDevice?: string;
  visibilityState: LiveVisibilityState;
  captureStrategy: LiveCaptureStrategy;
  renderPreservationStrategy: LiveRenderPreservationStrategy;
  revision: number;
  createdAtMs: number;
  lastSeenAtMs: number;
}

export interface LiveFrameMetadata {
  frameId: number;
  captureTimestampMs: number;
  encodeTimestampMs: number;
  width: number;
  height: number;
  keyframe: boolean;
  droppedFrames: number;
  colorSpace: LiveColorSpace;
  codec: LiveCodec;
}

export type LiveMouseButton = "left" | "middle" | "right" | "x1" | "x2";
export type LiveButtonState = "pressed" | "released";
export type LiveInputKind =
  | { kind: "mouse_move"; data: { x: number; y: number } }
  | {
      kind: "mouse_button";
      data: { button: LiveMouseButton; state: LiveButtonState; x: number; y: number; clickCount: number };
    }
  | { kind: "wheel"; data: { deltaX: number; deltaY: number; x: number; y: number } }
  | { kind: "key"; data: { code: string; state: LiveButtonState; modifiers: number } }
  | { kind: "text"; data: { text: string } }
  | { kind: "focus"; data: { focused: boolean } }
  | { kind: "cancel" };

export interface LiveInputEvent {
  inputSequence: number;
  issuedAtMs: number;
  sourceDeviceId: string;
  kind: LiveInputKind;
}

export type LiveObservationSource = "ui_automation" | "app_adapter" | "vision" | "unknown";
export type LiveObservationConfidence = "exact" | "high" | "medium" | "low";
export type LiveObservationState =
  | "unknown"
  | "detected"
  | "observing"
  | "stable"
  | "triggered"
  | "stale"
  | "error";

export interface LiveElementLocator {
  automationId?: string;
  name?: string;
  controlType: string;
  ancestorPath: string[];
  runtimeId?: number[];
}

export interface LiveObservation {
  observationId: string;
  sequence: number;
  state: LiveObservationState;
  source: LiveObservationSource;
  confidence: LiveObservationConfidence;
  observedAtMs: number;
  stableSinceMs?: number;
  locator?: LiveElementLocator;
  value?: unknown;
  reason?: string;
}

export interface LiveTriggerAudit {
  triggerId: string;
  bindingId: string;
  conditionRevision: number;
  observationId: string;
  observationSequence: number;
  sourceDeviceId: string;
  observationSource: LiveObservationSource;
  idempotencyKey: string;
  outcome: "fired" | "skipped" | "failed";
  evaluatedAtMs: number;
  authorizedBy: string;
  actionRequestId?: string;
  reason?: string;
}

export type LiveTriggerEvent = LiveTriggerAudit;

export interface LiveTriggerCondition {
  conditionId: string;
  revision: number;
  observationId: string;
  operator:
    | "equals"
    | "not_equals"
    | "greater_than"
    | "greater_or_equal"
    | "less_than"
    | "less_or_equal"
    | "contains";
  operand: unknown;
  stableForMs: number;
  risingEdge: boolean;
  rearm: boolean;
  minimumConfidence: LiveObservationConfidence;
}

interface LiveEnvelopeBase {
  protocolVersion: typeof LIVE_PROTOCOL_VERSION;
  sessionId: string;
  epoch: number;
  sequence: number;
}

export type LiveControlEnvelope = LiveEnvelopeBase &
  (
    | {
        messageType: "session_start";
        payload: { session: LiveScreenshotSession; requestedByDeviceId: string; requestNonce: string };
      }
    | {
        messageType: "session_ack";
        payload: { accepted: boolean; reason?: string; responderDeviceId: string };
      }
    | {
        messageType: "session_state";
        payload: {
          revision: number;
          visibility: LiveVisibilityState;
          viewers: string[];
          controllerDeviceId?: string;
          reason?: string;
        };
      }
    | { messageType: "frame_notice"; payload: { metadata: LiveFrameMetadata } }
    | { messageType: "input_event"; payload: LiveInputEvent }
    | { messageType: "observation"; payload: LiveObservation }
    | { messageType: "trigger_condition"; payload: LiveTriggerCondition }
    | { messageType: "trigger_event"; payload: LiveTriggerAudit }
    | {
        messageType: "control_transfer";
        payload: {
          previousControllerDeviceId?: string;
          controllerDeviceId?: string;
          authorityRevision: number;
          expiresAtMs: number;
          reason: string;
        };
      }
    | {
        messageType: "resume_request";
        payload: {
          lastControlSequence: number;
          lastFrameId: number;
          lastInputSequence: number;
          requesterDeviceId: string;
        };
      }
    | {
        messageType: "session_end";
        payload: {
          reason: "closed" | "revoked" | "source_closed" | "permission_denied" | "timed_out" | "error";
          endedByDeviceId: string;
          detail?: string;
        };
      }
  );

export const hookLiveContractCapabilities = {
  protocolVersion: LIVE_PROTOCOL_VERSION,
  status: "contract_only",
  roles: ["source", "viewer"] satisfies LiveDeviceRole[],
  mediaTransports: ["websocket_binary", "shared_memory"] satisfies LiveMediaTransport[],
  codecs: ["raw_bgra", "h264"] satisfies LiveCodec[],
  input: [
    "pointer_move",
    "pointer_button",
    "double_click",
    "drag",
    "wheel",
    "keyboard",
    "text",
    "focus",
    "cancel",
  ] satisfies LiveInteractionCapability[],
  reason: "Phase 1 defines the contract; runtime availability is negotiated per session.",
} as const;
