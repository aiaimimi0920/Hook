// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeUnitTabGeometry } from "../../src/components/unitTabGeometry";
import { addOrUpdateRect, removeRect, updatePortOffset } from "../../src/services/uiRegistry";
import type { Unit } from "../../src/types/unit";
vi.mock("../../src/services/uiRegistry", () => ({ addOrUpdateRect: vi.fn(), removeRect: vi.fn(), updatePortOffset: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.replaceChildren(); });
describe("Tab native input geometry", () => {
    it("measures visible controls, shrinks collapsed hit regions and disposes scheduled work", () => {
        const frames = new Map<number, FrameRequestCallback>(); let next = 0;
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
        vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
        const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
        const host = document.createElement("div"); host.className = "unit-container";
        host.innerHTML = '<div id="root"><div data-tab-hit-region><div data-panel-port data-port-name="value"></div></div></div>';
        document.body.append(host);
        const root = host.firstElementChild as HTMLElement;
        const row = root.firstElementChild as HTMLElement;
        const anchor = row.firstElementChild as HTMLElement;
        const rect = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) });
        vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(400, 100, 300, 200));
        const rowRect = vi.spyOn(row, "getBoundingClientRect").mockReturnValue(rect(150, 120, 256, 28));
        vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(rect(378, 120, 28, 28));
        const unit = { id: "geometry", x: 400, y: 100, w: 300, h: 200 } as Unit;
        const controller = observeUnitTabGeometry(root, () => unit);
        flush();
        expect(addOrUpdateRect).toHaveBeenLastCalledWith({ id: "tab-geometry-0", name: "PARAMS_PANEL", x: 150, y: 120, width: 256, height: 28 });
        expect(updatePortOffset).toHaveBeenLastCalledWith("geometry", "value", { x: -8, y: 34 });
        rowRect.mockReturnValue(rect(378, 120, 28, 28)); controller.refresh(); flush();
        expect(addOrUpdateRect).toHaveBeenLastCalledWith(expect.objectContaining({ x: 378, width: 28 }));
        controller.refresh(); controller.dispose(); flush();
        expect(frames.size).toBe(0);
        expect(removeRect).toHaveBeenCalledWith("tab-geometry-0");
    });
});
