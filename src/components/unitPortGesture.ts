import { onCleanup } from "solid-js";
import { linkingState } from "../store/uiStore";
import { unitPortCenter } from "./unitPortCenter";

/** Defer graph mutation until movement is intentional; a short press only opens the row. */
export function createUnitPortGesture() {
    let clear: (() => void) | undefined;
    onCleanup(() => clear?.());
    return (event: MouseEvent & { currentTarget: HTMLElement }, actions: {
        click: () => void;
        drag: (center: { x: number; y: number }, move: MouseEvent) => void;
    }) => {
        event.stopPropagation();
        if (event.button !== 0 || linkingState().isLinking) return;
        event.preventDefault();
        clear?.();
        const element = event.currentTarget;
        const center = unitPortCenter(element);
        const start = { x: event.clientX, y: event.clientY };
        let dragged = false;
        const moved = (next: MouseEvent) => Math.hypot(next.clientX - start.x, next.clientY - start.y) >= 5;
        const move = (next: MouseEvent) => {
            if (dragged || !moved(next)) return;
            dragged = true;
            actions.drag(center, next);
        };
        const up = (next: MouseEvent) => {
            const click = !dragged && !moved(next) && next.target instanceof Node && element.contains(next.target);
            clear?.();
            if (click) actions.click();
        };
        const cancel = () => clear?.();
        const key = (next: KeyboardEvent) => { if (next.key === "Escape") cancel(); };
        clear = () => {
            window.removeEventListener("mousemove", move, true);
            window.removeEventListener("mouseup", up, true);
            window.removeEventListener("blur", cancel);
            window.removeEventListener("keydown", key, true);
            clear = undefined;
        };
        window.addEventListener("mousemove", move, true);
        window.addEventListener("mouseup", up, true);
        window.addEventListener("blur", cancel);
        window.addEventListener("keydown", key, true);
    };
}
