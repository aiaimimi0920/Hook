import { afterEach, describe, expect, it, vi } from "vitest";
import { useNodeParameters } from "../../src/features/art/hooks/useNodeParameters";
import { graphStore } from "../../src/features/workspace/state/graphStore";
import { EXEC_upstreamDriven } from "../../src/features/workspace/model/constants";
vi.mock("../../src/features/workspace/services/syncService", () => ({ syncService: { performWorkflowSync: vi.fn() } }));
afterEach(() => { graphStore.setUnits([]); graphStore.setUnitExecConfig({}); });
describe("combined upstream execution switch", () => {
    it.each([true, false])("persists both compatible flags as %s without executing the node", async value => {
        graphStore.setUnits([{ id: "toggle", type: "art", x: 0, y: 0, w: 100, h: 100, params: {}, inputs: [], outputs: [], data: {} }]);
        await useNodeParameters().handleParamChange("toggle", EXEC_upstreamDriven, value);
        expect(graphStore.unitExecConfig.toggle.triggerMode.upstreamDriven).toBe(value);
        expect(graphStore.unitExecConfig.toggle.propagation.listenUpstream).toBe(value);
        expect(graphStore.units[0].data.executionConfig?.propagation.listenUpstream).toBe(value);
    });
});
