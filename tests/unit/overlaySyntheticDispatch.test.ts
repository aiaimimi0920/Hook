// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HAS_POINTER, setupOverlaySyntheticHarness, type Harness } from "./overlaySyntheticTestHarness";

let h: Harness;
beforeEach(() => {
    h = setupOverlaySyntheticHarness();
});
afterEach(() => {
    document.body.innerHTML = "";
});

describe("overlay synthetic events: dispatch metadata and reset", () => {
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
        // Collected into an array rather than a `let` so control-flow analysis
        // keeps the WheelEvent type across the listener boundary.
        const received: WheelEvent[] = [];
        h.a.addEventListener("wheel", (event) => {
            received.push(event);
        });
        h.setHit(() => h.a);

        h.d.dispatch("wheel", { x: 10, y: 10, deltaY: -120, altKey: true });

        expect(received).toHaveLength(1);
        expect(received[0].altKey).toBe(true);
        expect(received[0].ctrlKey).toBe(false);
        expect(received[0].deltaY).toBe(-120);
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

});
