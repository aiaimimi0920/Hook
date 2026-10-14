// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { UnitPropertyCapsule } from "../../src/components/UnitPropertyCapsule";
import { UnitParamControl } from "../../src/components/params/UnitParamControl";
import { requestUnitPropertyDisclosure, setUnitPropertyDisclosure } from "../../src/store/unitPropertyDisclosure";
import { setLinkingState } from "../../src/store/uiStore";

vi.mock("../../src/services/api", () => ({ api: { focusOverlayWindow: vi.fn().mockResolvedValue(undefined) } }));
let dispose: (() => void) | undefined;
afterEach(() => {
    dispose?.(); document.body.replaceChildren(); setUnitPropertyDisclosure(null);
    setLinkingState((value) => ({ ...value, isLinking: false }));
});

describe("individual property disclosure", () => {
    it("clicks toggle only that row without mutating links; Tab still controls all rows", () => {
        const start = vi.fn(); const move = vi.fn(); const drop = vi.fn();
        const [expanded, setExpanded] = createSignal(false);
        dispose = render(() => <>{["first", "second"].map(name => <UnitPropertyCapsule name={name} label={name}
            type="number" side="input" expanded={expanded()} register={vi.fn()} onLinkStart={start} onLinkMove={move} onLinkDrop={drop}>
            <input />
        </UnitPropertyCapsule>)}</>, document.body);
        const anchors = document.querySelectorAll<HTMLElement>(".unit-property-anchor");
        const click = () => {
            anchors[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }));
            anchors[0].dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 12, clientY: 10 }));
        };
        click();
        expect(anchors[0].getAttribute("aria-expanded")).toBe("true");
        expect(anchors[1].getAttribute("aria-expanded")).toBe("false");
        expect(start).not.toHaveBeenCalled(); expect(move).not.toHaveBeenCalled(); expect(drop).not.toHaveBeenCalled();
        click(); expect(anchors[0].getAttribute("aria-expanded")).toBe("false");
        setExpanded(true); expect([...anchors].every(anchor => anchor.getAttribute("aria-expanded") === "true")).toBe(true);
        setExpanded(false); expect([...anchors].every(anchor => anchor.getAttribute("aria-expanded") === "false")).toBe(true);
    });

    it("consumes a standalone port request and opens only its matching row", () => {
        requestUnitPropertyDisclosure("unit", "output", "output");
        dispose = render(() => <UnitPropertyCapsule unitId="unit" name="output" label="输出" type="image" side="output"
            expanded={false} register={vi.fn()}>{null}</UnitPropertyCapsule>, document.body);
        expect(document.querySelector(".unit-property-anchor")?.getAttribute("aria-expanded")).toBe("true");
    });

    it("cancels pending gestures on Escape and unmount", () => {
        const start = vi.fn();
        dispose = render(() => <UnitPropertyCapsule name="output" label="输出" type="image" side="output"
            expanded={false} register={vi.fn()} onLinkStart={start}>{null}</UnitPropertyCapsule>, document.body);
        const anchor = document.querySelector<HTMLElement>(".unit-property-anchor")!;
        anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 20 }));
        expect(start).not.toHaveBeenCalled();
        anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        dispose?.(); dispose = undefined;
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 20 }));
        expect(start).not.toHaveBeenCalled();
    });
});

describe("compact numeric property", () => {
    it.each(["slider", "number"] as const)("uses a slider and editable value without step buttons for %s", widget => {
        const [value, setValue] = createSignal(25);
        const change = vi.fn((next: number, _final?: boolean) => setValue(next));
        dispose = render(() => <UnitParamControl
            param={{ id: "amount", label: "数值", widget, default: 25, min: -100, max: 9999, step: 1 }} value={value()}
            isDisabled={false} onChange={(_id, next, final) => change(next, final)} onReset={vi.fn()} onToggleDisable={vi.fn()} />, document.body);
        expect(document.querySelector("[data-param-step-up], [data-param-step-down]")).toBeNull();
        const input = document.querySelector<HTMLInputElement>("[data-param-number-input]")!;
        const track = document.querySelector<HTMLElement>("[data-param-slider-track]")!;
        input.value = "1234"; input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("blur")); expect(change).toHaveBeenLastCalledWith(1234, true);
        vi.spyOn(track, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
        track.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100 }));
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 100 }));
        expect(input.value).toBe("9999"); expect(change).toHaveBeenLastCalledWith(9999, true);
    });
});
