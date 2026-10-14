// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { UnitSelectionBorder } from "../../src/components/UnitSelectionBorder";
import { getDragFollowerElements } from "../../src/services/dragFollowerRegistry";

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host.remove(); });
const mount = (view: Parameters<typeof render>[0]) => {
    host = document.createElement("div");
    host.style.zIndex = "1000";
    document.body.append(host);
    dispose = render(view, host);
};

describe("editing selection outline", () => {
    it("escapes the sticker stacking context without intercepting pointer input", () => {
        mount(() => <UnitSelectionBorder isSelected opacity={1}
            editingFrame={{ unitId: "outline", x: 200, y: 300, w: 400, h: 250 }} />);
        const outline = document.querySelector<HTMLElement>(".sticker-editing-outline")!;
        expect(host.contains(outline)).toBe(false);
        expect(outline.style.zIndex).toBe("1230");
        expect(outline.style.pointerEvents).toBe("none");
        expect([outline.style.left, outline.style.top, outline.style.width, outline.style.height])
            .toEqual(["198px", "298px", "404px", "254px"]);
        expect(getDragFollowerElements(["outline"]).map((item) => item.element)).toEqual([outline]);
        dispose?.(); dispose = undefined;
        expect(getDragFollowerElements(["outline"])).toEqual([]);
        expect(document.querySelector(".sticker-editing-outline")).toBeNull();
    });
    it("follows frame changes and restores the normal border when editing ends", () => {
        const [frame, setFrame] = createSignal<{ unitId: string; x: number; y: number; w: number; h: number }>();
        mount(() => <UnitSelectionBorder isSelected opacity={1} editingFrame={frame()} />);
        expect(host.querySelector(".selection-border")).not.toBeNull();
        setFrame({ unitId: "outline", x: 10, y: 20, w: 100, h: 80 });
        setFrame({ unitId: "outline", x: 30, y: 40, w: 200, h: 160 });
        expect(document.querySelector<HTMLElement>(".sticker-editing-outline")!.style.left).toBe("28px");
        expect(getDragFollowerElements(["outline"])).toHaveLength(1);
        setFrame(undefined);
        expect(document.querySelector(".sticker-editing-outline")).toBeNull();
        expect(host.querySelector(".selection-border")).not.toBeNull();
        expect(getDragFollowerElements(["outline"])).toEqual([]);
    });
});
