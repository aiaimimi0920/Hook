import type { OverlaySyntheticState } from "./overlaySyntheticState";

/** Dispatch enter/leave transitions in browser order: pointer events first. */
export const dispatchOverlaySyntheticHoverTransition = (
    state: OverlaySyntheticState,
    nextTarget: EventTarget | null,
    pointerInit: PointerEventInit,
    mouseInit: MouseEventInit,
): void => {
    const previousTarget = state.hoverTarget;
    if (previousTarget === nextTarget) return;

    if (previousTarget) {
        if (typeof PointerEvent !== "undefined") {
            previousTarget.dispatchEvent(new PointerEvent("pointerout", {
                ...pointerInit,
                relatedTarget: nextTarget,
            }));
            previousTarget.dispatchEvent(new PointerEvent("pointerleave", {
                ...pointerInit,
                bubbles: false,
                relatedTarget: nextTarget,
            }));
        }
        previousTarget.dispatchEvent(new MouseEvent("mouseout", {
            ...mouseInit,
            relatedTarget: nextTarget,
        }));
        previousTarget.dispatchEvent(new MouseEvent("mouseleave", {
            ...mouseInit,
            bubbles: false,
            relatedTarget: nextTarget,
        }));
    }

    if (nextTarget) {
        if (typeof PointerEvent !== "undefined") {
            nextTarget.dispatchEvent(new PointerEvent("pointerover", {
                ...pointerInit,
                relatedTarget: previousTarget,
            }));
            nextTarget.dispatchEvent(new PointerEvent("pointerenter", {
                ...pointerInit,
                bubbles: false,
                relatedTarget: previousTarget,
            }));
        }
        nextTarget.dispatchEvent(new MouseEvent("mouseover", {
            ...mouseInit,
            relatedTarget: previousTarget,
        }));
        nextTarget.dispatchEvent(new MouseEvent("mouseenter", {
            ...mouseInit,
            bubbles: false,
            relatedTarget: previousTarget,
        }));
    }

    state.hoverTarget = nextTarget;
};
