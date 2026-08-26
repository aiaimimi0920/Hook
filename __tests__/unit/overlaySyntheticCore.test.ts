// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shouldResetOverlaySyntheticOnGlobalMouseUp } from "../../src/services/overlaySyntheticEvents";
import { setupOverlaySyntheticHarness, type Harness } from "./overlaySyntheticTestHarness";

let h: Harness;
beforeEach(() => {
    h = setupOverlaySyntheticHarness();
});
afterEach(() => {
    document.body.innerHTML = "";
});

describe("overlay synthetic events: core hover and click", () => {
    it("keeps synthetic down state through a bubbling Tauri mouseup so click is delivered", () => {
        h.setHit(() => h.a);
        let clicks = 0;
        h.a.addEventListener("click", () => {
            clicks += 1;
        });
        const globalMouseUp = (event: MouseEvent) => {
            if (shouldResetOverlaySyntheticOnGlobalMouseUp(true, event.isTrusted)) {
                h.d.reset();
            }
        };
        document.addEventListener("mouseup", globalMouseUp);

        try {
            h.d.dispatch("mousedown", { x: 10, y: 10 });
            h.d.dispatch("mouseup", { x: 10, y: 10 });
        } finally {
            document.removeEventListener("mouseup", globalMouseUp);
        }

        expect(clicks).toBe(1);
    });

    it("only leaves reset ownership to the dispatcher for untrusted Tauri mouseup events", () => {
        expect(shouldResetOverlaySyntheticOnGlobalMouseUp(true, false)).toBe(false);
        expect(shouldResetOverlaySyntheticOnGlobalMouseUp(true, true)).toBe(true);
        expect(shouldResetOverlaySyntheticOnGlobalMouseUp(false, false)).toBe(true);
        expect(shouldResetOverlaySyntheticOnGlobalMouseUp(false, true)).toBe(true);
    });

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

    it("clears the frozen hover target before the next real move enters a control", () => {
        h.setHit(() => h.a);
        h.d.dispatch("mousemove", { x: 10, y: 10 });
        h.clear();

        h.d.clearHover();
        expect(h.typesFor("A")).toEqual([
            "pointerout",
            "pointerleave",
            "mouseout",
            "mouseleave",
        ]);

        h.clear();
        h.setHit(() => h.b);
        h.d.dispatch("mousemove", { x: 50, y: 50 });
        expect(h.typesFor("B")).toEqual([
            "pointerover",
            "pointerenter",
            "mouseover",
            "mouseenter",
            "pointermove",
            "mousemove",
        ]);
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

    it("delivers a direct Surface control click when native down/up jitter exceeds 4px", () => {
        const button = document.createElement("button");
        button.dataset.overlaySyntheticTarget = "direct";
        h.sticker.append(button);
        let clicks = 0;
        button.addEventListener("click", () => {
            clicks += 1;
        });
        h.setHit(() => button);

        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.d.dispatch("mouseup", { x: 16, y: 11 });

        expect(clicks).toBe(1);
    });

});
