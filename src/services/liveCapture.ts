export type LiveCaptureRuntimeState = "starting" | "streaming" | "recovering" | "failed" | "closed";

export interface LiveCaptureStartRequest {
    windowId?: string;
    sourceTitle?: string;
    windowRegion?: { x: number; y: number; width: number; height: number };
    x: number;
    y: number;
    width: number;
    height: number;
    targetFps?: number;
}

export interface LiveCaptureStatus {
    sessionId: string;
    sourceKind: "window" | "region";
    sourceWindowId?: string | null;
    sourceTitle?: string | null;
    sourceProcessId?: number | null;
    captureState: LiveCaptureRuntimeState;
    visibilityState: "visible" | "capture_recovering" | "capture_failed" | "closed";
    targetFps: number;
    maxBufferedFrames: number;
    epoch: number;
    frameId: number;
    /** Logical source size in the Hook WebView coordinate space. */
    width: number;
    height: number;
    droppedFrames: number;
    createdAtMs: number;
    lastFrameAtMs?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    sourceWindowState: "visible" | "logically_hidden" | "not_applicable" | "unsupported" | "closed";
    inputCapability: "window_message" | "unsupported_region" | "permission_denied" | "different_session" | "unavailable";
    interactionEnabled: boolean;
    logicalHideReason?: string | null;
}

export type LiveCaptureInputKind =
    | "mouse_move"
    | "mouse_button_down"
    | "mouse_button_up"
    | "mouse_wheel"
    | "key_down"
    | "key_up";

export interface LiveCaptureInputRequest {
    sequence: number;
    kind: LiveCaptureInputKind;
    normalizedX?: number;
    normalizedY?: number;
    button?: "left" | "right" | "middle";
    wheelDelta?: number;
    wheelAxis?: "vertical" | "horizontal";
    clickCount?: 1 | 2;
    virtualKey?: number;
}

export type LiveCaptureInputPayload = Omit<LiveCaptureInputRequest, "sequence">;

export interface LiveCaptureFrameDescriptor {
    sessionId: string;
    epoch: number;
    frameId: number;
    captureTimestampMs: number;
    encodeTimestampMs: number;
    width: number;
    height: number;
    mime: "image/jpeg" | "image/png";
    byteLength: number;
    droppedFrames: number;
}

export interface LiveCapturePollResponse {
    status: LiveCaptureStatus;
    frame?: LiveCaptureFrameDescriptor | null;
}

export interface LiveCaptureView {
    sessionId: string;
    status: LiveCaptureStatus;
    imageUrl?: string;
    renderedFrameId: number;
    x: number;
    y: number;
    width: number;
    height: number;
    controlErrorCode?: string;
    controlErrorMessage?: string;
}

export interface LiveCaptureSelection {
    windowId?: string;
    sourceTitle?: string;
    windowRegion?: { x: number; y: number; w: number; h: number };
    rect: { x: number; y: number; w: number; h: number };
}

export function initialLiveViewGeometry(
    source: { width: number; height: number },
    viewport: { width: number; height: number },
    origin: { x: number; y: number } = { x: 24, y: 72 },
): Pick<LiveCaptureView, "x" | "y" | "width" | "height"> {
    const sourceWidth = Math.max(1, source.width);
    const sourceHeight = Math.max(1, source.height);
    const viewportWidth = Math.max(1, viewport.width);
    const viewportHeight = Math.max(1, viewport.height);
    // A capture selected inside this viewport must initially occupy that exact
    // logical rectangle. Only scale when a restored/external source is larger
    // than the entire viewport; fixed margins made normal captures look smaller.
    const scale = Math.min(1, viewportWidth / sourceWidth, viewportHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    return {
        x: Math.min(Math.max(0, origin.x), Math.max(0, viewportWidth - width)),
        y: Math.min(Math.max(0, origin.y), Math.max(0, viewportHeight - height)),
        width,
        height,
    };
}

export function clampLiveViewGeometry(
    geometry: Pick<LiveCaptureView, "x" | "y" | "width" | "height">,
    viewport: { width: number; height: number },
    source?: { width: number; height: number },
): Pick<LiveCaptureView, "x" | "y" | "width" | "height"> {
    const viewportWidth = Math.max(1, viewport.width);
    const viewportHeight = Math.max(1, viewport.height);
    if (source) {
        const sourceWidth = Math.max(1, source.width);
        const sourceHeight = Math.max(1, source.height);
        const requestedScale = Math.min(
            Math.max(1, geometry.width) / sourceWidth,
            Math.max(1, geometry.height) / sourceHeight,
        );
        const minScale = Math.min(1, 16 / Math.min(sourceWidth, sourceHeight));
        const scale = Math.min(
            Math.max(minScale, requestedScale),
            viewportWidth / sourceWidth,
            viewportHeight / sourceHeight,
        );
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        return {
            width,
            height,
            x: Math.min(Math.max(0, geometry.x), Math.max(0, viewportWidth - width)),
            y: Math.min(Math.max(0, geometry.y), Math.max(0, viewportHeight - height)),
        };
    }
    const width = Math.min(Math.max(Math.min(240, viewportWidth), geometry.width), viewportWidth);
    const height = Math.min(Math.max(Math.min(160, viewportHeight), geometry.height), viewportHeight);
    return {
        width,
        height,
        x: Math.min(Math.max(0, geometry.x), Math.max(0, viewport.width - width)),
        y: Math.min(Math.max(0, geometry.y), Math.max(0, viewport.height - height)),
    };
}
