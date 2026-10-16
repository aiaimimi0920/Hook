// Stable public facade for the overlay synthetic-event engine. Internal owners
// import each other directly so this facade remains a one-way API boundary.
export {
    JAVASCRIPT_SURFACE_POINTER_EVENT,
    OVERLAY_GLOBAL_MOUSE_UP_EVENT,
} from "./overlaySyntheticTypes";
export type {
    JavaScriptSurfacePointerDetail,
    OverlaySyntheticDeps,
    OverlaySyntheticDispatcher,
    OverlaySyntheticEventType,
    OverlaySyntheticMousePayload,
} from "./overlaySyntheticTypes";
export { createOverlaySyntheticDispatcher } from "./overlaySyntheticDispatch";

export function shouldResetOverlaySyntheticOnGlobalMouseUp(
    tauriRuntime: boolean,
    isTrusted: boolean,
): boolean {
    // In Tauri, an untrusted mouseup was dispatched by this engine. Resetting
    // here would erase the down target before click synthesis completes.
    return !tauriRuntime || isTrusted;
}
