// Shared observable-DOM harness for overlay synthetic-event contracts.
import { createOverlaySyntheticDispatcher, type OverlaySyntheticDispatcher } from "../../src/services/overlaySyntheticEvents";

export const HAS_POINTER = typeof PointerEvent !== "undefined";

const TRACKED_TYPES = [
    "pointerover",
    "pointerenter",
    "pointerout",
    "pointerleave",
    "pointerdown",
    "pointerup",
    "pointermove",
    "mouseover",
    "mouseenter",
    "mouseout",
    "mouseleave",
    "mousedown",
    "mouseup",
    "mousemove",
    "click",
    "dblclick",
    "wheel",
    "contextmenu",
] as const;

export interface Harness {
    d: OverlaySyntheticDispatcher;
    appMain: HTMLElement;
    a: HTMLElement;
    b: HTMLElement;
    sticker: HTMLElement;
    input: HTMLInputElement;
    log: string[];
    lastButtons: Map<string, number>;
    lastButton: Map<string, number>;
    lastDeltaY: Map<string, number>;
    setHit: (fn: (x: number, y: number) => EventTarget | null) => void;
    setLinking: (v: boolean) => void;
    setDragging: (v: string | null) => void;
    setClock: (v: number) => void;
    clear: () => void;
    typesFor: (name: string) => string[];
}

function makeEl(tag: string, name: string, log: string[], meta: Harness): HTMLElement {
    const el = document.createElement(tag);
    for (const type of TRACKED_TYPES) {
        el.addEventListener(type, (event) => {
            log.push(`${name}:${type}`);
            const me = event as MouseEvent & { deltaY?: number };
            if (typeof me.buttons === "number") meta.lastButtons.set(`${name}:${type}`, me.buttons);
            if (typeof me.button === "number") meta.lastButton.set(`${name}:${type}`, me.button);
            if (typeof me.deltaY === "number") meta.lastDeltaY.set(`${name}:${type}`, me.deltaY);
        });
    }
    return el;
}

export function setupOverlaySyntheticHarness(): Harness {
    document.body.innerHTML = "";
    const log: string[] = [];
    let hit: (x: number, y: number) => EventTarget | null = () => null;
    let linking = false;
    let dragging: string | null = null;
    let clock = 1000;

    const meta = {
        lastButtons: new Map<string, number>(),
        lastButton: new Map<string, number>(),
        lastDeltaY: new Map<string, number>(),
    } as Harness;

    const appMain = makeEl("div", "app", log, meta);
    appMain.id = "app-main";
    const a = makeEl("div", "A", log, meta);
    const b = makeEl("div", "B", log, meta);
    const sticker = makeEl("div", "S", log, meta);
    sticker.setAttribute("data-sticker-interaction-root", "true");
    const input = makeEl("input", "I", log, meta) as HTMLInputElement;

    document.body.append(appMain, a, b, sticker, input);

    const d = createOverlaySyntheticDispatcher({
        doc: document,
        elementFromPoint: (x, y) => hit(x, y),
        isLinking: () => linking,
        getDraggingStickerId: () => dragging,
        now: () => clock,
    });

    Object.assign(meta, {
        d,
        appMain,
        a,
        b,
        sticker,
        input,
        log,
        setHit: (fn: (x: number, y: number) => EventTarget | null) => {
            hit = fn;
        },
        setLinking: (v: boolean) => {
            linking = v;
        },
        setDragging: (v: string | null) => {
            dragging = v;
        },
        setClock: (v: number) => {
            clock = v;
        },
        clear: () => {
            log.length = 0;
        },
        typesFor: (name: string) =>
            log.filter((entry) => entry.startsWith(`${name}:`)).map((entry) => entry.split(":")[1]),
    });

    return meta;
}
