// Sandbox-to-host keydown relay policy.
//
// A JavaScript Surface runs in a sandboxed iframe, and its bootstrap forwards
// keydown events to the host so that host-owned shortcuts keep working while
// focus sits inside the surface. The host then re-dispatches them on `window`
// as real `KeyboardEvent`s, which means sandboxed content can synthesize
// keystrokes that are indistinguishable from the user's own.
//
// Two rules live here, both of which the relay in JavaScriptSurface.tsx and the
// host's `window` keydown listeners depend on.
//
// 1. Only the keys the host actually consumes from a surface are relayed at all
//    (`isRelayableSurfaceHostKeydown`). Shape validation is not enough: it lets
//    any key with any modifier combination through, so the next global shortcut
//    anyone adds would become sandbox-reachable for free. Adding a shortcut that
//    must work from inside a surface is therefore a deliberate edit here.
//
// 2. Relayed events are tagged (`markSurfaceRelayedKeydown`) so host listeners
//    can tell them apart from the user's keystrokes. `event.isTrusted` cannot do
//    that job in Hook: the native overlay keyboard hook also replays untrusted
//    keydowns (app.tsx's `overlay/global_shortcut` listener), and those are
//    genuine user input. Listeners default to ignoring tagged events and opt in
//    with `acceptsSurfaceRelayedKeydown` only where a surface-originated key is
//    meaningful.

export interface SurfaceHostKeydownShape {
    key: string;
    code: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
}

// Escape dismisses transient host overlays; the bare modifier keys keep the
// sticker annotation layer's modifier tracking in sync while a host drag that
// started inside a surface is still running. Ctrl+E is Hook's reserved
// edit-mode shortcut, which the bootstrap relays even from interactive targets.
export const isRelayableSurfaceHostKeydown = (keydown: SurfaceHostKeydownShape): boolean => {
    if (keydown.code === "KeyE") {
        return keydown.ctrlKey && !keydown.altKey && !keydown.shiftKey && !keydown.metaKey;
    }
    if (keydown.key === "Escape") {
        return !keydown.ctrlKey && !keydown.altKey && !keydown.shiftKey && !keydown.metaKey;
    }
    // A modifier keydown reports its own modifier as held, and the others stay
    // free because pressing Ctrl then Shift must still relay the Shift press.
    if (keydown.key === "Control") return keydown.ctrlKey;
    if (keydown.key === "Shift") return keydown.shiftKey;
    if (keydown.key === "Alt") return keydown.altKey;
    return false;
};

const SURFACE_RELAYED_KEYDOWN_FLAG = "hookSurfaceRelayedKeydown";

export const markSurfaceRelayedKeydown = <EventType extends Event>(event: EventType): EventType => {
    Object.defineProperty(event, SURFACE_RELAYED_KEYDOWN_FLAG, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
    });
    return event;
};

export const isSurfaceRelayedKeydown = (event: Event): boolean =>
    (event as unknown as Record<string, unknown>)[SURFACE_RELAYED_KEYDOWN_FLAG] === true;

// Host `window` keydown listeners call this first. `surfaceRelayed: true` is the
// opt-in for handlers whose behavior is still correct when the keystroke came
// from sandboxed content; everything else drops relayed events.
export const acceptsSurfaceRelayedKeydown = (
    event: Event,
    options?: { surfaceRelayed?: boolean },
): boolean => options?.surfaceRelayed === true || !isSurfaceRelayedKeydown(event);
