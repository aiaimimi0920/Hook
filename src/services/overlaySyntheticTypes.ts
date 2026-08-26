/** Raw native overlay sample forwarded to the webview. */
export type OverlaySyntheticMousePayload = {
    x?: number;
    y?: number;
    globalX?: number;
    globalY?: number;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    metaKey?: boolean;
    deltaY?: number;
    nativeDragPreflight?: boolean;
};

export type OverlaySyntheticEventType =
    | "mousedown"
    | "mousemove"
    | "mouseup"
    | "wheel"
    | "contextmenu";

export const OVERLAY_GLOBAL_MOUSE_UP_EVENT = "hook:overlay-global-mouse-up";
export const JAVASCRIPT_SURFACE_POINTER_EVENT = "hook:javascript-surface-pointer";

export interface JavaScriptSurfacePointerDetail extends OverlaySyntheticMousePayload {
    type: OverlaySyntheticEventType;
    gestureId?: number;
}

export interface OverlaySyntheticDeps {
    /** Document the synthetic events are dispatched against. */
    doc: Document;
    /** Deterministic hit-test hook for jsdom and isolated tests. */
    elementFromPoint?: (x: number, y: number) => EventTarget | null;
    /** Live read of whether the canvas is currently drawing a link. */
    isLinking: () => boolean;
    /** Live read of the sticker currently being dragged, if any. */
    getDraggingStickerId: () => string | null;
    /** Clock used by double-click detection. */
    now?: () => number;
    /** Window used for overlay-root comparisons and fallback dispatch. */
    win?: Window;
}

export interface OverlaySyntheticDispatcher {
    dispatch: (type: OverlaySyntheticEventType, payload: OverlaySyntheticMousePayload) => void;
    relayPointerMove: (event: MouseEvent) => void;
    /** Leave the current synthetic hover target without generating a new enter. */
    clearHover: () => void;
    reset: () => void;
    readonly moveRelayActive: boolean;
}

export const OVERLAY_SYNTHETIC_CLICK_MAX_DISTANCE = 4;
// Native shield coordinates may move slightly between down/up over a
// transformed Art Surface. Ordinary canvas clicks retain the strict limit.
export const OVERLAY_SYNTHETIC_INTERACTIVE_CLICK_MAX_DISTANCE = 8;
export const OVERLAY_SYNTHETIC_DOUBLE_CLICK_MAX_DELAY_MS = 320;
