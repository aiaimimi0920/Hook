import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnitActions } from "../../src/hooks/useUnitActions";
import { graphStore } from "../../src/store/graphStore";
import { DEFAULT_EXECUTION_CONFIG, type Unit } from "../../src/types/unit";
const mocks = vi.hoisted(() => ({ change: vi.fn() }));
vi.mock("../../src/hooks/useNodeParameters", () => ({ useNodeParameters: () => ({ handleParamChange: mocks.change }) }));
vi.mock("../../src/services/syncService", () => ({ syncService: { performWorkflowSync: vi.fn() } }));
const make = (id: string, type: Unit["type"], notify = true): Unit => ({
    id, type, x: 0, y: 0, w: 100, h: 100, params: {}, inputs: [], outputs: [],
    data: { src: id === "source" ? "data:image/png;base64,AAAA" : undefined,
        executionConfig: { ...DEFAULT_EXECUTION_CONFIG, propagation: { listenUpstream: true, notifyDownstream: notify } } },
});
afterEach(() => { graphStore.setUnits([]); graphStore.setLinks([]); graphStore.setUnitExecConfig({}); vi.useRealTimers(); vi.clearAllMocks(); });
describe("downstream notification policy", () => {
    it.each([false, true])("refreshes sticker data while automatic notification is %s", async notify => {
        vi.useFakeTimers();
        graphStore.setUnits([make("source", "sticker", notify), make("relay", "sticker"), make("target", "art")]);
        graphStore.setLinks([
            { id: "a", fromUnitId: "source", fromPortId: "output_image", toUnitId: "relay", toPortId: "image" },
            { id: "b", fromUnitId: "relay", fromPortId: "output_image", toUnitId: "target", toPortId: "image" },
        ]);
        useUnitActions().propagateFromUnit("source");
        await vi.runAllTimersAsync();
        expect(graphStore.units.find(unit => unit.id === "relay")?.data.previewSrc).toBe("data:image/png;base64,AAAA");
        expect(mocks.change).toHaveBeenCalledTimes(notify ? 1 : 0);
    });
    it("also respects the intermediate sticker's notification switch", async () => {
        vi.useFakeTimers();
        graphStore.setUnits([make("source", "sticker"), make("relay", "sticker", false), make("target", "art")]);
        graphStore.setLinks([
            { id: "a", fromUnitId: "source", fromPortId: "output_image", toUnitId: "relay", toPortId: "image" },
            { id: "b", fromUnitId: "relay", fromPortId: "output_image", toUnitId: "target", toPortId: "image" },
        ]);
        useUnitActions().propagateFromUnit("source");
        await vi.runAllTimersAsync();
        expect(graphStore.units[1].data.previewSrc).toBeTruthy();
        expect(mocks.change).not.toHaveBeenCalled();
    });
});
