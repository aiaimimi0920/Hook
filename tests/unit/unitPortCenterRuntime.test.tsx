// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { UnitPropertyCapsule } from "../../src/features/workspace/components/UnitPropertyCapsule";
import { UnitPorts } from "../../src/features/art/components/UnitPorts";
import { useLinking } from "../../src/features/workspace/hooks/useLinking";
import { graphStore } from "../../src/features/workspace/state/graphStore";
import { linkingState, setUnitUiState, setMultiDragPositions } from "../../src/features/workspace/state/uiStore";
import { updatePortOffset } from "../../src/platform/desktop/uiRegistry";
import type { Unit } from "../../src/features/workspace/types/unit";

vi.mock("../../src/features/workspace/services/syncService", () => ({ syncService: { performWorkflowSync: vi.fn() } }));
const unit: Unit = { id: "center-source", type: "sticker", x: 100, y: 200, w: 300, h: 200,
    params: {}, inputs: [], outputs: [], data: {} };
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); graphStore.setUnits([]); graphStore.setLinks([]); setMultiDragPositions(null); });

describe("port link start geometry", () => {
    it.each([false, true])("starts the capsule link at its center, expanded=%s", (expanded) => {
        const start = vi.fn();
        dispose = render(() => <UnitPropertyCapsule name="output_image" label="输出" type="image" side="output"
            expanded={expanded} register={vi.fn()} onLinkStart={start}>{null}</UnitPropertyCapsule>, document.body);
        const anchor = document.querySelector<HTMLElement>(".unit-property-anchor")!;
        vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({ left: 388, top: 222, width: 28, height: 28 } as DOMRect);
        anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 413, clientY: 240 }));
        expect(start).not.toHaveBeenCalled();
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 423, clientY: 240 }));
        expect(start).toHaveBeenCalledWith("output_image", 402, 236);
    });

    it("uses the full port center for the clipped standalone glyph", () => {
        const start = vi.fn();
        dispose = render(() => <UnitPorts unit={unit} portsLayer={document.body} isCleanView={false}
            x={100} y={200} width={300} height={200} onLinkStart={start} onLinkDrop={vi.fn()} />, document.body);
        const port = document.querySelector<HTMLElement>('[data-port-name="output_image"]')!;
        vi.spyOn(port, "getBoundingClientRect").mockReturnValue({ left: 389, top: 224, width: 24, height: 24 } as DOMRect);
        port.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 410, clientY: 242 }));
        expect(start).not.toHaveBeenCalled();
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 420, clientY: 242 }));
        expect(start).toHaveBeenCalledWith("output_image", 401, 236);
    });

    it("relinks from the registered source center, including live node movement", () => {
        graphStore.setUnits([unit]);
        graphStore.setLinks([{ id: "center-link", fromUnitId: unit.id, fromPortId: "output_image", toUnitId: "target", toPortId: "image" }]);
        setUnitUiState(unit.id, { showParams: true, showActions: false });
        updatePortOffset(unit.id, "output_image", { x: 302, y: 72 });
        setMultiDragPositions({ [unit.id]: { x: 120, y: 230 } });
        useLinking().handleInputLinkDrag("target", "image", new MouseEvent("mousedown", { clientX: 700, clientY: 300 }));
        expect(linkingState()).toMatchObject({ startX: 422, startY: 302 });
        expect(graphStore.links).toHaveLength(0);
    });
});
