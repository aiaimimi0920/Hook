// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { createOverlaySyntheticDispatcher } from "../../src/services/overlaySyntheticEvents";

describe("overlay synthetic coordinate validation", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("falls back from non-finite client coordinates before hit testing and dispatch", () => {
        const target = document.createElement("div");
        document.body.append(target);
        const hitPoints: Array<[number, number]> = [];
        const received: MouseEvent[] = [];
        target.addEventListener("mousedown", (event) => {
            received.push(event as MouseEvent);
        });
        const dispatcher = createOverlaySyntheticDispatcher({
            doc: document,
            elementFromPoint: (x, y) => {
                hitPoints.push([x, y]);
                return target;
            },
            isLinking: () => false,
            getDraggingStickerId: () => null,
        });

        dispatcher.dispatch("mousedown", {
            x: Number.NaN,
            y: Number.POSITIVE_INFINITY,
            globalX: 42,
            globalY: 24,
        });

        expect(hitPoints).toEqual([[42, 24]]);
        expect(received[0]?.clientX).toBe(42);
        expect(received[0]?.clientY).toBe(24);
        expect(received[0]?.screenX).toBe(42);
        expect(received[0]?.screenY).toBe(24);
    });

    it("uses zero only when no finite coordinate exists and preserves finite negatives", () => {
        const target = document.createElement("div");
        document.body.append(target);
        const hitPoints: Array<[number, number]> = [];
        const dispatcher = createOverlaySyntheticDispatcher({
            doc: document,
            elementFromPoint: (x, y) => {
                hitPoints.push([x, y]);
                return target;
            },
            isLinking: () => false,
            getDraggingStickerId: () => null,
        });

        dispatcher.dispatch("mousemove", {
            x: Number.NEGATIVE_INFINITY,
            globalX: Number.NaN,
            y: -12,
        });

        expect(hitPoints).toEqual([[0, -12]]);
    });
});
