// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupOverlaySyntheticHarness, type Harness } from "./overlaySyntheticTestHarness";

let h: Harness;
beforeEach(() => {
    h = setupOverlaySyntheticHarness();
});
afterEach(() => {
    document.body.innerHTML = "";
});

describe("overlay synthetic events: JavaScript Surface relay", () => {
    it("9. focuses an editable control on mousedown and on the synthesized click", () => {
        h.setHit(() => h.input);
        h.d.dispatch("mousedown", { x: 10, y: 10 });
        expect(document.activeElement).toBe(h.input);
        h.input.blur();
        h.d.dispatch("mouseup", { x: 10, y: 10 });
        expect(document.activeElement).toBe(h.input);
    });

    it("keeps Surface controls as direct targets instead of promoting them to sticker drag roots", () => {
        const surface = document.createElement("div");
        surface.dataset.overlaySyntheticTarget = "direct";
        h.sticker.append(surface);
        surface.append(h.input);
        h.setHit(() => h.input);

        h.d.dispatch("mousedown", { x: 10, y: 10 });
        h.d.dispatch("mouseup", { x: 10, y: 10 });

        expect(document.activeElement).toBe(h.input);
        expect(h.typesFor("I")).toEqual(expect.arrayContaining(["mousedown", "mouseup", "click"]));
        expect(h.typesFor("S")).toEqual(expect.arrayContaining(["mousedown", "mouseup", "click"]));
    });

    it("relays native-shield pointer samples to a JavaScript Surface iframe", () => {
        const iframe = document.createElement("iframe");
        iframe.dataset.javascriptSurfaceFrame = "true";
        iframe.dataset.overlaySyntheticTarget = "direct";
        h.sticker.append(iframe);
        const received: Array<{ type: string; x?: number; y?: number; gestureId?: number }> = [];
        let parentMouseEvents = 0;
        iframe.addEventListener("hook:javascript-surface-pointer", (event) => {
            received.push((event as CustomEvent).detail);
        });
        for (const eventType of ["mousedown", "mousemove", "mouseup", "click"]) {
            iframe.addEventListener(eventType, () => {
                parentMouseEvents += 1;
            });
        }
        h.setHit(() => iframe);

        h.d.dispatch("mousedown", { x: 12, y: 18 });
        h.d.relayPointerMove({
            clientX: 24,
            clientY: 30,
            screenX: 24,
            screenY: 30,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
            buttons: 1,
            target: h.b,
        } as unknown as MouseEvent);
        h.d.dispatch("mouseup", { x: 24, y: 30 });

        expect(received).toEqual([
            expect.objectContaining({ type: "mousedown", x: 12, y: 18 }),
            expect.objectContaining({ type: "mousemove", x: 24, y: 30 }),
            expect.objectContaining({ type: "mouseup", x: 24, y: 30 }),
        ]);
        expect(received[0].gestureId).toBeGreaterThan(0);
        expect(received.map((event) => event.gestureId)).toEqual([
            received[0].gestureId,
            received[0].gestureId,
            received[0].gestureId,
        ]);
        expect(parentMouseEvents).toBe(0);
    });

    it("relays native-shield pointer samples when hit-testing returns the Surface host", () => {
        const host = document.createElement("div");
        host.className = "javascript-surface-host";
        host.dataset.overlaySyntheticTarget = "direct";
        const iframe = document.createElement("iframe");
        iframe.dataset.javascriptSurfaceFrame = "true";
        host.append(iframe);
        h.sticker.append(host);
        const received: Array<{ type: string; x?: number; y?: number }> = [];
        iframe.addEventListener("hook:javascript-surface-pointer", (event) => {
            received.push((event as CustomEvent).detail);
        });
        h.setHit(() => host);

        h.d.dispatch("mousedown", { x: 12, y: 18 });
        h.d.dispatch("mouseup", { x: 12, y: 18 });

        expect(received).toEqual([
            expect.objectContaining({ type: "mousedown", x: 12, y: 18 }),
            expect.objectContaining({ type: "mouseup", x: 12, y: 18 }),
        ]);
    });

    it("uses the ordinary parent double-click path when a minified JavaScript Surface is non-interactive", () => {
        const host = document.createElement("div");
        host.className = "javascript-surface-host";
        host.dataset.overlaySyntheticTarget = "direct";
        const iframe = document.createElement("iframe");
        iframe.dataset.javascriptSurfaceFrame = "true";
        iframe.dataset.javascriptSurfaceInteractive = "false";
        host.append(iframe);
        h.sticker.append(host);
        let relayedPointerEvents = 0;
        iframe.addEventListener("hook:javascript-surface-pointer", () => {
            relayedPointerEvents += 1;
        });
        h.setHit(() => host);

        h.setClock(1_000);
        h.d.dispatch("mousedown", { x: 12, y: 18 });
        h.d.dispatch("mouseup", { x: 12, y: 18 });
        h.setClock(1_200);
        h.d.dispatch("mousedown", { x: 12, y: 18 });
        h.d.dispatch("mouseup", { x: 12, y: 18 });

        expect(relayedPointerEvents).toBe(0);
        expect(h.typesFor("S")).toContain("dblclick");
    });

});
