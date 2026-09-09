import {
  LIVE_MAX_DIMENSION,
  LIVE_PROTOCOL_VERSION,
  type LiveControlEnvelope,
} from "./liveProtocol";

const MESSAGE_TYPES = new Set([
  "session_start",
  "session_ack",
  "session_state",
  "frame_notice",
  "input_event",
  "observation",
  "trigger_condition",
  "trigger_event",
  "control_transfer",
  "resume_request",
  "session_end",
]);
const ID_PATTERN = /^[A-Za-z0-9_.:/-]{1,160}$/;
const SOURCE_KINDS = ["window", "display", "region"] as const;
const REGION_ANCHORS = ["window", "control", "screen"] as const;
const TRANSPORTS = ["websocket_binary", "shared_memory", "cloud_relay"] as const;
const CODECS = ["raw_bgra", "h264"] as const;
const COLOR_SPACES = ["srgb", "hdr10"] as const;
const VISIBILITY_STATES = [
  "visible", "unfocused", "logical_minimized", "logical_hidden", "restoring", "capture_recovering", "capture_failed", "closed",
] as const;
const CAPTURE_STRATEGIES = ["persistent_window_wgc", "persistent_display_wgc", "adapter"] as const;
const PRESERVATION_STRATEGIES = ["visible", "visible_offscreen", "hidden_workspace", "application_adapter", "unsupported"] as const;
const INTERACTION_CAPABILITIES = ["pointer_move", "pointer_button", "double_click", "drag", "wheel", "keyboard", "text", "focus", "cancel"] as const;
const OBSERVATION_CAPABILITIES = ["uia_tree", "invoke", "range_value", "value", "toggle", "scroll", "adapter", "vision"] as const;
const OBSERVATION_STATES = ["unknown", "detected", "observing", "stable", "triggered", "stale", "error"] as const;
const OBSERVATION_SOURCES = ["ui_automation", "app_adapter", "vision", "unknown"] as const;
const CONFIDENCES = ["exact", "high", "medium", "low"] as const;

export function parseLiveControlEnvelope(input: unknown): LiveControlEnvelope {
  const value = record(input, "live envelope");
  exactKeys(value, ["protocolVersion", "sessionId", "epoch", "sequence", "messageType", "payload"]);
  if (value.protocolVersion !== LIVE_PROTOCOL_VERSION) throw new Error("unsupported live protocol version");
  identifier(value.sessionId, "sessionId");
  positiveInteger(value.epoch, "epoch");
  positiveInteger(value.sequence, "sequence");
  if (typeof value.messageType !== "string" || !MESSAGE_TYPES.has(value.messageType)) {
    throw new Error("unsupported live message type");
  }
  const payload = record(value.payload, "payload");
  validatePayload(value.messageType, payload, value.sessionId as string);
  return value as unknown as LiveControlEnvelope;
}

function validatePayload(messageType: string, value: Record<string, unknown>, sessionId: string): void {
  switch (messageType) {
    case "session_start": {
      exactKeys(value, ["session", "requestedByDeviceId", "requestNonce"]);
      validateSession(record(value.session, "session"), sessionId);
      identifier(value.requestedByDeviceId, "requestedByDeviceId");
      identifier(value.requestNonce, "requestNonce");
      return;
    }
    case "session_ack":
      exactKeys(value, ["accepted", "responderDeviceId"], ["reason"]);
      boolean(value.accepted, "accepted");
      identifier(value.responderDeviceId, "responderDeviceId");
      optionalReason(value.reason);
      return;
    case "session_state":
      exactKeys(value, ["revision", "visibility", "viewers"], ["controllerDeviceId", "reason"]);
      nonNegativeInteger(value.revision, "revision");
      enumValue(value.visibility, VISIBILITY_STATES, "visibility");
      identifierArray(value.viewers, "viewers", 32);
      optionalIdentifier(value.controllerDeviceId, "controllerDeviceId");
      optionalReason(value.reason);
      return;
    case "frame_notice":
      exactKeys(value, ["metadata"]);
      validateFrameMetadata(record(value.metadata, "metadata"));
      return;
    case "input_event":
      validateInputEvent(value);
      return;
    case "observation":
      validateObservation(value);
      return;
    case "trigger_condition":
      exactKeys(value, ["conditionId", "revision", "observationId", "operator", "operand", "stableForMs", "risingEdge", "rearm", "minimumConfidence"]);
      identifier(value.conditionId, "conditionId");
      identifier(value.observationId, "observationId");
      positiveInteger(value.revision, "revision");
      nonNegativeInteger(value.stableForMs, "stableForMs");
      if ((value.stableForMs as number) > 86_400_000) throw new Error("invalid stableForMs");
      enumValue(value.operator, ["equals", "not_equals", "greater_than", "greater_or_equal", "less_than", "less_or_equal", "contains"], "operator");
      enumValue(value.minimumConfidence, CONFIDENCES, "minimumConfidence");
      boolean(value.risingEdge, "risingEdge");
      boolean(value.rearm, "rearm");
      validateTriggerOperand(value.operand, value.operator);
      return;
    case "trigger_event":
      exactKeys(
        value,
        [
          "triggerId",
          "bindingId",
          "conditionRevision",
          "observationId",
          "observationSequence",
          "sourceDeviceId",
          "observationSource",
          "idempotencyKey",
          "outcome",
          "evaluatedAtMs",
          "authorizedBy",
        ],
        ["actionRequestId", "reason"],
      );
      for (const field of ["triggerId", "bindingId", "observationId", "sourceDeviceId", "idempotencyKey", "authorizedBy"] as const) {
        identifier(value[field], field);
      }
      optionalIdentifier(value.actionRequestId, "actionRequestId");
      positiveInteger(value.conditionRevision, "conditionRevision");
      positiveInteger(value.observationSequence, "observationSequence");
      enumValue(value.observationSource, OBSERVATION_SOURCES, "observationSource");
      enumValue(value.outcome, ["fired", "skipped", "failed"], "outcome");
      positiveInteger(value.evaluatedAtMs, "evaluatedAtMs");
      optionalReason(value.reason);
      return;
    case "control_transfer":
      exactKeys(value, ["authorityRevision", "expiresAtMs", "reason"], ["previousControllerDeviceId", "controllerDeviceId"]);
      optionalIdentifier(value.previousControllerDeviceId, "previousControllerDeviceId");
      optionalIdentifier(value.controllerDeviceId, "controllerDeviceId");
      nonNegativeInteger(value.authorityRevision, "authorityRevision");
      nonNegativeInteger(value.expiresAtMs, "expiresAtMs");
      optionalReason(value.reason);
      return;
    case "resume_request":
      exactKeys(value, ["lastControlSequence", "lastFrameId", "lastInputSequence", "requesterDeviceId"]);
      for (const field of ["lastControlSequence", "lastFrameId", "lastInputSequence"] as const) {
        nonNegativeInteger(value[field], field);
      }
      identifier(value.requesterDeviceId, "requesterDeviceId");
      return;
    case "session_end":
      exactKeys(value, ["reason", "endedByDeviceId"], ["detail"]);
      enumValue(value.reason, ["closed", "revoked", "source_closed", "permission_denied", "timed_out", "error"], "reason");
      identifier(value.endedByDeviceId, "endedByDeviceId");
      optionalReason(value.detail);
  }
}

function validateSession(value: Record<string, unknown>, envelopeSessionId: string): void {
  exactKeys(
    value,
    [
      "protocolVersion",
      "sessionId",
      "sourceDeviceId",
      "sourceHookId",
      "sourceKind",
      "sourceWindowIdentity",
      "sourceRegion",
      "regionAnchor",
      "frameStream",
      "interactionCapabilities",
      "observationCapabilities",
      "triggerBindings",
      "viewerDevices",
      "visibilityState",
      "captureStrategy",
      "renderPreservationStrategy",
      "revision",
      "createdAtMs",
      "lastSeenAtMs",
    ],
    ["controllerDevice"],
  );
  if (value.protocolVersion !== LIVE_PROTOCOL_VERSION) throw new Error("unsupported session protocol version");
  if (value.sessionId !== envelopeSessionId) throw new Error("live session id mismatch");
  for (const field of ["sessionId", "sourceDeviceId", "sourceHookId"] as const) identifier(value[field], field);
  enumValue(value.sourceKind, SOURCE_KINDS, "sourceKind");
  const windowIdentity = record(value.sourceWindowIdentity, "sourceWindowIdentity");
  exactKeys(windowIdentity, ["windowId", "processId"], ["processStartedAtMs", "title"]);
  identifier(windowIdentity.windowId, "windowId");
  boundedInteger(windowIdentity.processId, 0, 0xffff_ffff, "processId");
  optionalNonNegativeInteger(windowIdentity.processStartedAtMs, "processStartedAtMs");
  optionalBoundedString(windowIdentity.title, 0, 512, "title");
  validateRect(record(value.sourceRegion, "sourceRegion"));
  enumValue(value.regionAnchor, REGION_ANCHORS, "regionAnchor");
  const stream = record(value.frameStream, "frameStream");
  exactKeys(
    stream,
    ["streamId", "transport", "codec", "colorSpace", "width", "height", "targetFps", "maxBufferedFrames", "keyframeInterval"],
    ["endpoint"],
  );
  identifier(stream.streamId, "streamId");
  enumValue(stream.transport, TRANSPORTS, "transport");
  optionalBoundedString(stream.endpoint, 0, 2_048, "endpoint");
  enumValue(stream.codec, CODECS, "codec");
  enumValue(stream.colorSpace, COLOR_SPACES, "colorSpace");
  dimensions(stream.width, stream.height);
  positiveInteger(stream.targetFps, "targetFps");
  if ((stream.targetFps as number) > 120) throw new Error("invalid targetFps");
  if (stream.maxBufferedFrames !== 2 && stream.maxBufferedFrames !== 3) throw new Error("invalid live frame buffer bound");
  boundedInteger(stream.keyframeInterval, 1, 3_600, "keyframeInterval");
  enumArray(value.interactionCapabilities, INTERACTION_CAPABILITIES, "interactionCapabilities");
  enumArray(value.observationCapabilities, OBSERVATION_CAPABILITIES, "observationCapabilities");
  validateTriggerBindings(value.triggerBindings);
  identifierArray(value.viewerDevices, "viewerDevices", 32);
  optionalIdentifier(value.controllerDevice, "controllerDevice");
  enumValue(value.visibilityState, VISIBILITY_STATES, "visibilityState");
  enumValue(value.captureStrategy, CAPTURE_STRATEGIES, "captureStrategy");
  enumValue(value.renderPreservationStrategy, PRESERVATION_STRATEGIES, "renderPreservationStrategy");
  nonNegativeInteger(value.revision, "revision");
  nonNegativeInteger(value.createdAtMs, "createdAtMs");
  nonNegativeInteger(value.lastSeenAtMs, "lastSeenAtMs");
  if ((value.lastSeenAtMs as number) < (value.createdAtMs as number)) throw new Error("invalid session timestamps");
}

function validateTriggerBindings(input: unknown): void {
  if (!Array.isArray(input)) throw new Error("invalid triggerBindings");
  if (input.length > 64) throw new Error("too many triggerBindings");
  input.forEach((item) => {
    const value = record(item, "triggerBinding");
    exactKeys(value, ["bindingId", "observationId", "conditionRevision", "authorizedBy", "enabled"]);
    for (const field of ["bindingId", "observationId", "authorizedBy"] as const) identifier(value[field], field);
    positiveInteger(value.conditionRevision, "conditionRevision");
    boolean(value.enabled, "enabled");
  });
}

function validateRect(value: Record<string, unknown>): void {
  exactKeys(value, ["x", "y", "width", "height"]);
  integer(value.x, "x");
  integer(value.y, "y");
  dimensions(value.width, value.height);
}

function validateFrameMetadata(value: Record<string, unknown>): void {
  exactKeys(value, ["frameId", "captureTimestampMs", "encodeTimestampMs", "width", "height", "keyframe", "droppedFrames", "colorSpace", "codec"]);
  positiveInteger(value.frameId, "frameId");
  nonNegativeInteger(value.captureTimestampMs, "captureTimestampMs");
  nonNegativeInteger(value.encodeTimestampMs, "encodeTimestampMs");
  if ((value.encodeTimestampMs as number) < (value.captureTimestampMs as number)) throw new Error("invalid frame timestamps");
  dimensions(value.width, value.height);
  boolean(value.keyframe, "keyframe");
  nonNegativeInteger(value.droppedFrames, "droppedFrames");
  enumValue(value.colorSpace, COLOR_SPACES, "colorSpace");
  enumValue(value.codec, CODECS, "codec");
}

function validateInputEvent(value: Record<string, unknown>): void {
  exactKeys(value, ["inputSequence", "issuedAtMs", "sourceDeviceId", "kind"]);
  positiveInteger(value.inputSequence, "inputSequence");
  nonNegativeInteger(value.issuedAtMs, "issuedAtMs");
  identifier(value.sourceDeviceId, "sourceDeviceId");
  const kind = record(value.kind, "input kind");
  enumValue(kind.kind, ["mouse_move", "mouse_button", "wheel", "key", "text", "focus", "cancel"], "kind");
  if (kind.kind === "cancel") {
    exactKeys(kind, ["kind"]);
    return;
  }
  exactKeys(kind, ["kind", "data"]);
  const data = record(kind.data, "input data");
  switch (kind.kind) {
    case "mouse_move":
      exactKeys(data, ["x", "y"]);
      point(data.x, data.y);
      return;
    case "mouse_button":
      exactKeys(data, ["button", "state", "x", "y", "clickCount"]);
      enumValue(data.button, ["left", "middle", "right", "x1", "x2"], "button");
      enumValue(data.state, ["pressed", "released"], "state");
      point(data.x, data.y);
      boundedInteger(data.clickCount, 1, 2, "clickCount");
      return;
    case "wheel":
      exactKeys(data, ["deltaX", "deltaY", "x", "y"]);
      boundedInteger(data.deltaX, -0x8000_0000, 0x7fff_ffff, "deltaX");
      boundedInteger(data.deltaY, -0x8000_0000, 0x7fff_ffff, "deltaY");
      point(data.x, data.y);
      return;
    case "key":
      exactKeys(data, ["code", "state", "modifiers"]);
      boundedString(data.code, 1, 80, "code");
      enumValue(data.state, ["pressed", "released"], "state");
      boundedInteger(data.modifiers, 0, 255, "modifiers");
      return;
    case "text":
      exactKeys(data, ["text"]);
      if (typeof data.text !== "string" || [...data.text].length < 1 || [...data.text].length > 4_096) throw new Error("invalid text");
      return;
    case "focus":
      exactKeys(data, ["focused"]);
      boolean(data.focused, "focused");
  }
}

function validateObservation(value: Record<string, unknown>): void {
  exactKeys(value, ["observationId", "sequence", "state", "source", "confidence", "observedAtMs"], ["stableSinceMs", "locator", "value", "reason"]);
  identifier(value.observationId, "observationId");
  positiveInteger(value.sequence, "sequence");
  enumValue(value.state, OBSERVATION_STATES, "state");
  enumValue(value.source, OBSERVATION_SOURCES, "source");
  enumValue(value.confidence, CONFIDENCES, "confidence");
  nonNegativeInteger(value.observedAtMs, "observedAtMs");
  optionalNonNegativeInteger(value.stableSinceMs, "stableSinceMs");
  if (typeof value.stableSinceMs === "number" && value.stableSinceMs > (value.observedAtMs as number)) {
    throw new Error("stableSinceMs cannot exceed observedAtMs");
  }
  if (["unknown", "stale", "error"].includes(value.state) && value.value !== undefined && value.value !== null) {
    throw new Error("untrusted observation cannot carry a value");
  }
  if (value.source === "unknown" && value.confidence !== "low") throw new Error("unknown source must be low confidence");
  if (value.source === "vision" && value.confidence === "exact") throw new Error("visual source cannot be exact confidence");
  if (value.source === "ui_automation" && value.locator === undefined) throw new Error("UI Automation observation requires a locator");
  if (value.locator !== undefined) validateLocator(record(value.locator, "locator"));
  optionalReason(value.reason);
}

function validateTriggerOperand(input: unknown, operator: unknown): void {
  const encoded = JSON.stringify(input);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > 4_096) {
    throw new Error("invalid trigger operand size");
  }
  const pending: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 1 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (current.depth > 16 || nodes > 512) throw new Error("invalid trigger operand shape");
    if (Array.isArray(current.value)) {
      pending.push(...current.value.map((value) => ({ value, depth: current.depth + 1 })));
    } else if (typeof current.value === "object" && current.value !== null) {
      pending.push(...Object.values(current.value).map((value) => ({ value, depth: current.depth + 1 })));
    }
  }
  let expected = input;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const selector = input as Record<string, unknown>;
    if ("path" in selector || "value" in selector) {
      exactKeys(selector, ["path", "value"]);
      boundedString(selector.path, 2, 256, "trigger operand path");
      if (!(selector.path as string).startsWith("/")) throw new Error("invalid trigger operand path");
      expected = selector.value;
    }
  }
  if (["greater_than", "greater_or_equal", "less_than", "less_or_equal"].includes(String(operator))
      && (typeof expected !== "number" || !Number.isFinite(expected))) {
    throw new Error("numeric trigger operator requires a finite operand");
  }
}

function validateLocator(value: Record<string, unknown>): void {
  exactKeys(value, ["controlType", "ancestorPath"], ["automationId", "name", "runtimeId"]);
  optionalBoundedString(value.automationId, 1, 512, "automationId");
  optionalBoundedString(value.name, 1, 512, "name");
  boundedString(value.controlType, 1, 160, "controlType");
  boundedStringArray(value.ancestorPath, 64, 512, "ancestorPath");
  if (value.runtimeId !== undefined) {
    if (!Array.isArray(value.runtimeId) || value.runtimeId.length > 64) throw new Error("invalid runtimeId");
    value.runtimeId.forEach((item) => boundedInteger(item, -0x8000_0000, 0x7fff_ffff, "runtimeId"));
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("live object fields do not match the v1 contract");
  }
}

function identifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error(`invalid ${field}`);
}

function optionalIdentifier(value: unknown, field: string): void {
  if (value !== undefined) identifier(value, field);
}

function identifierArray(value: unknown, field: string, max: number): void {
  if (!Array.isArray(value) || value.length > max) throw new Error(`invalid ${field}`);
  value.forEach((item) => identifier(item, field));
}

function enumArray(value: unknown, allowed: readonly string[], field: string): void {
  if (!Array.isArray(value) || new Set(value).size !== value.length) throw new Error(`invalid ${field}`);
  value.forEach((item) => enumValue(item, allowed, field));
}

function boundedStringArray(value: unknown, maxItems: number, maxLength: number, field: string): void {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`invalid ${field}`);
  value.forEach((item) => boundedString(item, 1, maxLength, field));
}

function enumValue(value: unknown, allowed: readonly string[], field: string): asserts value is string {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`invalid ${field}`);
}

function point(x: unknown, y: unknown): void {
  for (const [value, field] of [[x, "x"], [y, "y"]] as const) {
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
      throw new Error(`invalid ${field}`);
    }
  }
}

function dimensions(width: unknown, height: unknown): void {
  positiveInteger(width, "width");
  positiveInteger(height, "height");
  if ((width as number) > LIVE_MAX_DIMENSION || (height as number) > LIVE_MAX_DIMENSION) throw new Error("invalid dimensions");
}

function integer(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`invalid ${field}`);
}

function positiveInteger(value: unknown, field: string): asserts value is number {
  integer(value, field);
  if (value <= 0) throw new Error(`invalid ${field}`);
}

function nonNegativeInteger(value: unknown, field: string): asserts value is number {
  integer(value, field);
  if (value < 0) throw new Error(`invalid ${field}`);
}

function boundedInteger(value: unknown, min: number, max: number, field: string): asserts value is number {
  integer(value, field);
  if (value < min || value > max) throw new Error(`invalid ${field}`);
}

function boolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`invalid ${field}`);
}

function boundedString(value: unknown, min: number, max: number, field: string): asserts value is string {
  if (typeof value !== "string" || value.length < min || value.length > max) throw new Error(`invalid ${field}`);
}

function optionalBoundedString(value: unknown, min: number, max: number, field: string): void {
  if (value !== undefined) boundedString(value, min, max, field);
}

function optionalNonNegativeInteger(value: unknown, field: string): void {
  if (value !== undefined) nonNegativeInteger(value, field);
}

function optionalReason(value: unknown): void {
  if (value !== undefined && (typeof value !== "string" || value.length === 0 || value.length > 512)) {
    throw new Error("invalid live reason");
  }
}
