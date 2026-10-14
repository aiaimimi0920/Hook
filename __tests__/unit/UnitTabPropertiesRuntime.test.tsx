// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { UnitPropertyCapsule } from "../../src/components/UnitPropertyCapsule";
import { propertyType } from "../../src/components/UnitPropertyTypeIcon";
import { UnitNodeSettingsStrip } from "../../src/components/UnitNodeSettingsStrip";
import { UnitSelectionBorder, unitOutlineOutset } from "../../src/components/UnitSelectionBorder";
import { DEFAULT_EXECUTION_CONFIG, type Unit } from "../../src/types/unit";
import { EXEC_upstreamDriven, EXEC_notifyDownstream } from "../../src/constants";
import { graphStore } from "../../src/store/graphStore";
import { cycleUnitChromeMode, setUnitChromeMode } from "../../src/store/unitChromeState";
import { setLinkingState } from "../../src/store/uiStore";
vi.mock("../../src/services/syncService", () => ({ syncService: { performWorkflowSync: vi.fn() } }));
const unit: Unit = { id: "tab-test", type: "art", x: 0, y: 0, w: 300, h: 200, params: {}, inputs: [], outputs: [], data: {} };
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); graphStore.setUnits([]); setUnitChromeMode("all"); });
const mount = (view: () => ReturnType<typeof UnitNodeSettingsStrip>) => {
    const host = document.createElement("div"); document.body.append(host); dispose = render(view, host); return host;
};
describe("Tab property controls", () => {
    it("toggles upstream edit propagation on the current sticker settings without changing another unit", () => {
        graphStore.setUnits([{ ...unit, type: "sticker", data: {} }, { ...unit, id: "other", data: {} }]);
        const host = mount(() => <UnitNodeSettingsStrip unit={graphStore.units[0]} expanded onParamChange={vi.fn()} />);
        const toggle = host.querySelector<HTMLButtonElement>('[aria-label="接受上级贴图编辑传导"]')!;
        expect(toggle.getAttribute("aria-pressed")).toBe("true");
        toggle.click();
        expect(graphStore.units[0].data.stickerEditPropagation?.acceptUpstream).toBe(false);
        expect(graphStore.units[1].data.stickerEditPropagation).toBeUndefined();
        expect(toggle.getAttribute("aria-pressed")).toBe("false");
        toggle.click();
        expect(graphStore.units[0].data.stickerEditPropagation?.acceptUpstream).toBe(true);
    });
    it("does not duplicate the sticker fit action in the current Tab panel", () => {
        const host = mount(() => <UnitNodeSettingsStrip unit={{ ...unit, type: "sticker" }} expanded onParamChange={vi.fn()} />);
        expect(host.querySelector("button[aria-label='合拢外框']")).toBeNull();
    });
    it("hides the collapsed triangle in both global hidden modes while Tab remains usable", () => {
        const [expanded, setExpanded] = createSignal(false);
        const host = mount(() => <UnitNodeSettingsStrip unit={unit} expanded={expanded()} onParamChange={vi.fn()} />);
        expect(host.querySelector(".unit-node-expand")).not.toBeNull();
        for (let index = 0; index < 2; index++) {
            cycleUnitChromeMode();
            expect(host.querySelector(".unit-node-expand")).toBeNull();
            setExpanded(true);
            expect(host.querySelector(".unit-node-expand")).not.toBeNull();
            expect(host.querySelector(".unit-node-strip")).not.toBeNull();
            setExpanded(false);
            expect(host.querySelector(".unit-node-expand")).toBeNull();
        }
        cycleUnitChromeMode();
        expect(host.querySelector(".unit-node-expand")).not.toBeNull();
    });
    it("hides collapsed chrome per unit but Tab always restores controls", () => {
        graphStore.setUnits([{ ...unit, data: {} }, { ...unit, id: "other", data: {} }]);
        const [expanded, setExpanded] = createSignal(true);
        const host = mount(() => <UnitNodeSettingsStrip unit={graphStore.units[0]} expanded={expanded()} onParamChange={vi.fn()} />);
        host.querySelector<HTMLButtonElement>('[aria-label="显示/隐藏端点"]')!.click();
        expect(graphStore.units[0].data.hideCollapsedEndpoints).toBe(true);
        expect(graphStore.units[1].data.hideCollapsedEndpoints).toBeUndefined();
        expect(host.querySelector(".unit-node-expand")).not.toBeNull();
        setExpanded(false);
        expect(host.querySelector(".unit-node-expand")).toBeNull();
        expect(host.querySelector(".unit-node-strip")).toBeNull();
        setExpanded(true);
        const toggle = host.querySelector<HTMLButtonElement>('[aria-label="显示/隐藏端点"]')!;
        expect(toggle.getAttribute("aria-pressed")).toBe("false");
        toggle.click();
        setExpanded(false);
        expect(host.querySelector(".unit-node-expand")).not.toBeNull();
    });
    it("shares the actual outside outline width with the port positioning", () => {
        const [selected, setSelected] = createSignal(false);
        const host = mount(() => <UnitSelectionBorder isSelected={selected()} opacity={1} />);
        const border = host.querySelector<HTMLElement>(".selection-border")!;
        expect(border.style.inset).toBe(`${-unitOutlineOutset(false)}px`);
        expect(border.style.borderWidth).toBe("1px");
        setSelected(true);
        expect(border.style.inset).toBe(`${-unitOutlineOutset(true)}px`);
        expect(border.style.borderWidth).toBe("2px");
    });
    it("uses a stable unique shape for each property kind", () => {
        expect([propertyType("float"), propertyType("string"), propertyType("bool"), propertyType(undefined, "select"), propertyType("color"), propertyType("image")])
            .toEqual(["number", "text", "boolean", "select", "color", "image"]);
    });
    it("keeps the link anchor alive and makes only the collapsed body inert", () => {
        const drop = vi.fn(); const move = vi.fn(); const register = vi.fn();
        const [expanded, setExpanded] = createSignal(false);
        const host = mount(() => <UnitPropertyCapsule name="amount" label="数量" type="number" side="input" expanded={expanded()}
            register={register} onLinkDrop={drop} onLinkMove={move}><input /></UnitPropertyCapsule>);
        const anchor = host.querySelector<HTMLElement>("[data-panel-port]")!;
        expect(register).toHaveBeenCalledWith(anchor, "amount");
        expect(host.querySelector<HTMLElement>(".unit-property-body")?.inert).toBe(true);
        anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        expect(move).not.toHaveBeenCalled();
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 10 }));
        setLinkingState({ isLinking: true, sourceUnitId: "other", sourceParamId: "output_image", startX: 0, startY: 0 });
        anchor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        expect(move).toHaveBeenCalled(); expect(drop).toHaveBeenCalledWith("amount");
        setLinkingState((previous) => ({ ...previous, isLinking: false }));
        setExpanded(true);
        expect(host.querySelector("[data-panel-port]")).toBe(anchor);
        expect(host.querySelector<HTMLElement>(".unit-property-body")?.inert).toBe(false);
    });
    it("follows Tab, allows independent drawer toggling and combines legacy upstream flags", () => {
        const change = vi.fn(); const [expanded, setExpanded] = createSignal(false);
        const config = { ...DEFAULT_EXECUTION_CONFIG, propagation: { listenUpstream: false, notifyDownstream: true } };
        const host = mount(() => <UnitNodeSettingsStrip unit={unit} execConfig={config} expanded={expanded()} onParamChange={change} />);
        expect(host.querySelector(".unit-node-strip")).toBeNull();
        setExpanded(true);
        const upstream = host.querySelector<HTMLButtonElement>('[aria-label="上游变化自动执行"]')!;
        expect(host.querySelector('[aria-label="更多节点操作"]')).toBeNull();
        expect(host.querySelector(".unit-node-more")).toBeNull();
        expect(upstream.getAttribute("aria-pressed")).toBe("false");
        upstream.click(); expect(change).toHaveBeenLastCalledWith(EXEC_upstreamDriven, true);
        host.querySelector<HTMLButtonElement>('[aria-label="通知下游"]')!.click();
        expect(change).toHaveBeenLastCalledWith(EXEC_notifyDownstream, false);
        host.querySelector<HTMLButtonElement>(".unit-node-expand")!.click();
        expect(host.querySelector(".unit-node-strip")).toBeNull();
        setExpanded(false); setExpanded(true);
        expect(host.querySelector(".unit-node-strip")).not.toBeNull();
        expect(host.querySelector('[aria-label="接受上级贴图编辑传导"]')).toBeNull();
    });
});
