import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNodeParameters } from "../../src/hooks/useNodeParameters";
import { graphStore } from "../../src/store/graphStore";
import type { ArtCapability } from "../../src/services/protocol";
import type { Unit } from "../../src/types/unit";
import { EXEC_manualTrigger } from "../../src/constants";
import { artExecutionRequests } from "../../src/services/artExecutionRequests";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), sync: vi.fn() }));
vi.mock("../../src/services/api", () => ({ api: {
    dispatchAction: mocks.dispatch, debugLogEvent: vi.fn(),
} }));
vi.mock("../../src/services/syncService", () => ({ syncService: {
    performWorkflowSync: mocks.sync, updateBackendRects: vi.fn(),
} }));

const capability = (surface = true, formal = false): ArtCapability => ({
    id: "test/dashboard", label: "Dashboard", description: "", params: [],
    supported_transports: [], execution: { type: "framework_art" },
    metadata: { capabilities: {
        requiresFormalExecution: formal,
        ...(surface ? { surface: {
            protocolVersion: "loom.surface.v1", apiVersion: "1.0",
            variants: [{ runtime: "declarative", entry: "surface/main.json" }],
        } } : {}),
    } },
});
const unit = (): Unit => ({
    id: "surface-routing", type: "art", artId: "test/dashboard",
    x: 0, y: 0, w: 200, h: 100, params: {}, data: {}, inputs: [], outputs: [],
});

beforeEach(() => {
    mocks.dispatch.mockReset().mockResolvedValue(undefined);
    mocks.sync.mockReset().mockResolvedValue(undefined);
    graphStore.actions.replaceUnits([unit()]);
    graphStore.setLinks([]);
    graphStore.setUnitParams({});
    graphStore.setUnitExecConfig({});
    graphStore.setCapabilities([capability()]);
    artExecutionRequests.invalidate("surface-routing");
});
afterEach(() => {
    graphStore.actions.replaceUnits([]);
    graphStore.setCapabilities([]);
    artExecutionRequests.invalidate("surface-routing");
});

describe("Surface and ordinary Art execution ownership", () => {
    it.each(["upstream", "param", "manual"] as const)(
        "does not invoke an event-only Surface runtime for a %s trigger", async (trigger) => {
            await useNodeParameters().handleParamChange("surface-routing", "input_image", true, true, trigger);
            expect(mocks.dispatch).not.toHaveBeenCalled();
            expect(graphStore.units[0].data.processing).not.toBe(true);
        },
    );
    it("keeps parameter persistence while leaving execution to declared Surface actions", async () => {
        await useNodeParameters().handleParamChange("surface-routing", "title", "saved", true);
        expect(graphStore.units[0].params?.title).toBe("saved");
        expect(mocks.dispatch).not.toHaveBeenCalled();
    });
    it("does not turn the ordinary execution button into an undeclared Surface action", async () => {
        await useNodeParameters().handleParamChange("surface-routing", EXEC_manualTrigger, true, true);
        expect(mocks.dispatch).not.toHaveBeenCalled();
    });
    it.each([[true, true], [false, false]])(
        "preserves formal execution for Surface=%s formal=%s", async (surface, formal) => {
            graphStore.setCapabilities([capability(surface, formal)]);
            await useNodeParameters().handleParamChange("surface-routing", "input_image", true, true, "upstream");
            expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ action: "execute_art" }));
        },
    );
});
