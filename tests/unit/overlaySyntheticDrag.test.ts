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

describe("overlay synthetic events: drag and linking", () => {
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
        const h2 = setupOverlaySyntheticHarness();
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
