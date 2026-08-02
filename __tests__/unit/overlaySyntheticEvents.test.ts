// @vitest-environment jsdom
//
// Characterization tests for the overlay synthetic mouse-event engine.
//
// These lock in the CURRENT behavior of every non-obvious branch that used to
// live inline in app.tsx (pointer capture, shift-bypass for sticker drag-out,
// live link-target resolution, sticker-drag target pinning, click / double-
// click synthesis and thresholds). They intentionally assert observable DOM
// behavior, not source text, so a future refactor is free to change structure
// as long as behavior is preserved.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    createOverlaySyntheticDispatcher,
    type OverlaySyntheticDispatcher,
} from "../../src/services/overlaySyntheticEvents";

const HAS_POINTER = typeof PointerEvent !== "undefined";

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

interface Harness {
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

function setup(): Harness {
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

let h: Harness;
beforeEach(() => {
    h = setup();
});
afterEach(() => {
    document.body.innerHTML = "";
});

describe("overlaySyntheticEvents", () => {
    it("1. dispatches leave-then-enter mouse transitions when hover target changes", () => {
        h.setHit(() => h.a);
        h.d.dispatch("mousemove", { x: 10, y: 10 });
        // First hover: no previous target, so only over/enter on A.
        expect(h.typesFor("A")).toEqual(
            expect.arrayContaining(["mouseover", "mouseenter"]),
        );
        expect(h.typesFor("A")).not.toContain("mouseout");

        h.clear();
        h.setHit(() => h.b);
        h.d.dispatch("mousemove", { x: 50, y: 50 });
        // A must fully leave before B is entered.
        const order = h.log.filter((e) =>
            ["A:mouseout", "A:mouseleave", "B:mouseover", "B:mouseenter"].includes(e),
        );
        expect(order).toEqual(["A:mouseout", "A:mouseleave", "B:mouseover", "B:mouseenter"]);
    });

    it("2. does not re-fire hover transitions when the target is unchanged", () => {
        h.setHit(() => h.a);
        h.d.dispatch("mousemove", { x: 10, y: 10 });
        h.clear();
        h.d.dispatch("mousemove", { x: 12, y: 12 }); // still over A
        const aTypes = h.typesFor("A");
        expect(aTypes).not.toContain("mouseover");
        expect(aTypes).not.toContain("mouseenter");
        expect(aTypes).not.toContain("mouseout");
        expect(aTypes).not.toContain("mouseleave");
        // The move itself still reaches A.
        expect(aTypes).toContain("mousemove");
    });

    it("3. keeps pointer capture: move/up route to the mousedown target and synthesize click", () => {
        h.setHit(() => h.a);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.setHit(() => h.b); // hit target changes mid-drag
        h.d.dispatch("mousemove", { x: 11, y: 11 });
        h.d.dispatch("mouseup", { x: 11, y: 11 });
        expect(h.typesFor("A")).toEqual(
            expect.arrayContaining(["mousedown", "mousemove", "mouseup", "click"]),
        );
        expect(h.typesFor("B")).toEqual([]);
    });

    it("4. synthesizes dblclick for a second click within the time+distance threshold", () => {
        h.setHit(() => h.a);
        h.setClock(1000);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.d.dispatch("mouseup", { x: 10, y: 10 });
        expect(h.typesFor("A")).toContain("click");
        expect(h.typesFor("A")).not.toContain("dblclick");

        h.clear();
        h.setClock(1200); // 200ms later, within 320ms
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.d.dispatch("mouseup", { x: 10, y: 10 });
        expect(h.typesFor("A")).toContain("click");
        expect(h.typesFor("A")).toContain("dblclick");
    });

    it("4b. does NOT synthesize dblclick once the double-click delay is exceeded", () => {
        h.setHit(() => h.a);
        h.setClock(1000);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.d.dispatch("mouseup", { x: 10, y: 10 });
        h.clear();
        h.setClock(1000 + 321); // just past the 320ms window
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.d.dispatch("mouseup", { x: 10, y: 10 });
        expect(h.typesFor("A")).toContain("click");
        expect(h.typesFor("A")).not.toContain("dblclick");
    });

    it("5. suppresses click when mouseup moves beyond the click-distance threshold", () => {
        h.setHit(() => h.a);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.d.dispatch("mouseup", { x: 20, y: 20 }); // ~14px away, > 4px
        expect(h.typesFor("A")).toContain("mouseup");
        expect(h.typesFor("A")).not.toContain("click");
    });

    it("6. shift+mousedown on a sticker interaction root bypasses pointer capture", () => {
        // Bypass case: after shift-mousedown on the sticker root, a later plain
        // mousemove should be treated as a fresh hover (capture NOT held), so it
        // reaches B instead of being pinned to the sticker.
        h.setHit(() => h.sticker);
        h.d.dispatch("mousedown", { x: 10, y: 10, shiftKey: true });
        h.clear();
        h.setHit(() => h.b);
        h.d.dispatch("mousemove", { x: 50, y: 50 });
        expect(h.typesFor("B")).toEqual(expect.arrayContaining(["mouseover", "mouseenter"]));

        // Control: a NON-shift mousedown on the same root DOES hold capture, so
        // the identical later move stays pinned to the sticker and never reaches B.
        const h2 = setup();
        h2.setHit(() => h2.sticker);
        h2.d.dispatch("mousedown", { x: 10, y: 10 });
        h2.clear();
        h2.setHit(() => h2.b);
        h2.d.dispatch("mousemove", { x: 50, y: 50 });
        expect(h2.typesFor("B")).toEqual([]);
        expect(h2.typesFor("S")).toContain("mousemove");
    });

    it("7. pins the move target to #app-main while a sticker is being dragged", () => {
        h.setDragging("s1");
        h.setHit(() => h.a);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.clear();
        h.d.dispatch("mousemove", { x: 50, y: 50 });
        expect(h.typesFor("app")).toContain("mousemove");
        expect(h.typesFor("A")).not.toContain("mousemove");
    });

    it("8. re-resolves the live target for move/up while linking", () => {
        h.setLinking(true);
        h.setHit(() => h.a);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.setHit(() => h.b); // link endpoint moved over B
        h.clear();
        h.d.dispatch("mousemove", { x: 50, y: 50 });
        // Live resolution wins over pointer capture: move lands on B, not A.
        expect(h.typesFor("B")).toContain("mousemove");
        expect(h.typesFor("A")).not.toContain("mousemove");
    });

    it("9. focuses an editable control on mousedown and on the synthesized click", () => {
        h.setHit(() => h.input);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        expect(document.activeElement).toBe(h.input);
        h.input.blur();
        h.d.dispatch("mouseup", { x: 10, y: 10 });
        expect(document.activeElement).toBe(h.input);
    });

    it("10. sets the correct button/buttons bitmask per event kind", () => {
        h.setHit(() => h.a);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        expect(h.lastButtons.get("A:mousedown")).toBe(1);
        h.d.dispatch("mouseup", { x: 10, y: 10 });
        expect(h.lastButtons.get("A:mouseup")).toBe(0);

        h.clear();
        h.d.dispatch("contextmenu", { x: 10, y: 10 });
        expect(h.lastButton.get("A:contextmenu")).toBe(2);
        expect(h.lastButtons.get("A:contextmenu")).toBe(0);
    });

    it("11. dispatches a WheelEvent carrying deltaY", () => {
        h.setHit(() => h.a);
        h.d.dispatch("wheel", { x: 10, y: 10, deltaY: 120 });
        expect(h.typesFor("A")).toContain("wheel");
        expect(h.lastDeltaY.get("A:wheel")).toBe(120);
    });

    it("11b. preserves Alt on a synthetic overlay wheel event", () => {
        let received: WheelEvent | null = null;
        h.a.addEventListener("wheel", (event) => {
            received = event;
        });
        h.setHit(() => h.a);

        h.d.dispatch("wheel", { x: 10, y: 10, deltaY: -120, altKey: true });

        expect(received).not.toBeNull();
        expect(received?.altKey).toBe(true);
        expect(received?.ctrlKey).toBe(false);
        expect(received?.deltaY).toBe(-120);
    });

    it("12. leaves the current hover and dispatches nothing when a no-button move hits the overlay root", () => {
        h.setHit(() => h.a);
        h.d.dispatch("mousemove", { x: 10, y: 10 }); // hover A
        h.clear();
        h.setHit(() => h.appMain); // overlay root => no fallback for a hover move
        h.d.dispatch("mousemove", { x: 5, y: 5 });
        expect(h.typesFor("A")).toEqual(expect.arrayContaining(["mouseout", "mouseleave"]));
        // No mousemove is emitted anywhere because dispatch returns early.
        expect(h.log.filter((e) => e.endsWith(":mousemove"))).toEqual([]);
    });

    it("13. relays external pointer moves onto the captured target, guarding re-entry", () => {
        h.setHit(() => h.a);
        h.d.dispatch("mousedown", { x: 10, y: 10 }); // capture A
        h.clear();

        const externalOverB = {
            clientX: 5,
            clientY: 5,
            screenX: 5,
            screenY: 5,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            buttons: 1,
            target: h.b,
        } as unknown as MouseEvent;
        h.d.relayPointerMove(externalOverB);
        expect(h.typesFor("A")).toContain("mousemove");
        expect(h.d.moveRelayActive).toBe(false); // flag cleared after relay

        // Guard: an event already targeting the captured element is not relayed.
        h.clear();
        const externalOverA = { ...externalOverB, target: h.a } as unknown as MouseEvent;
        h.d.relayPointerMove(externalOverA);
        expect(h.typesFor("A")).not.toContain("mousemove");
    });

    it("14. reset() clears pointer capture so later relays are ignored", () => {
        h.setHit(() => h.a);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.d.reset();
        h.clear();
        const external = {
            clientX: 5,
            clientY: 5,
            screenX: 5,
            screenY: 5,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            buttons: 1,
            target: h.b,
        } as unknown as MouseEvent;
        h.d.relayPointerMove(external);
        expect(h.typesFor("A")).not.toContain("mousemove");
    });

    it("dispatches pointer events alongside mouse events when PointerEvent is supported", () => {
        if (!HAS_POINTER) return; // jsdom without PointerEvent: mouse-only path already covered
        h.setHit(() => h.a);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        expect(h.typesFor("A")).toContain("pointerdown");
    });

    it("15. skips elementFromPoint hit-testing on drag-move frames (perf, no layout thrash)", () => {
        let hitCalls = 0;
        h.setHit((_x, _y) => {
            hitCalls += 1;
            return h.a;
        });
        h.d.dispatch("mousedown", { x: 10, y: 10 }); // capture (a hit-test here is fine)
        h.setDragging("s1");
        hitCalls = 0; // measure only the drag-move phase

        h.d.dispatch("mousemove", { x: 20, y: 20 });
        h.d.dispatch("mousemove", { x: 30, y: 30 });

        // The target is pinned to #app-main during a sticker drag, so no
        // (layout-forcing) hit-test should run on these move frames.
        expect(hitCalls).toBe(0);
        // ...and the moves are still delivered to #app-main as before.
        expect(h.typesFor("app")).toContain("mousemove");
    });

    it("16. keeps a sticker drag captured across fast moves outside every hit-test region", () => {
        h.setHit(() => h.a);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.setDragging("s1");
        h.setHit(() => null);
        h.clear();

        h.d.dispatch("mousemove", { x: 10_000, y: 10_000 });
        h.d.dispatch("mousemove", { x: 20_000, y: 20_000 });
        h.d.dispatch("mouseup", { x: 20_000, y: 20_000 });

        expect(h.typesFor("app").filter((type) => type === "mousemove")).toHaveLength(2);
        expect(h.typesFor("A")).toContain("mouseup");
        expect(h.typesFor("A")).not.toContain("click");
        expect(h.typesFor("B")).toEqual([]);
    });
});
