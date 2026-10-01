import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overlayWindowApi } from "../../src/services/apiOverlayWindow";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("long capture native input handoff", () => {
    beforeEach(() => {
        invoke.mockReset();
        invoke.mockResolvedValue(undefined);
        vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("releases selection interception while retaining only long-capture Escape scope", async () => {
        await overlayWindowApi.setCaptureInputActive(false, true);
        expect(invoke).toHaveBeenCalledWith("set_capture_input_active", {
            active: false, longCapture: true,
        });
    });

    it.each([true, false])("clears long-capture scope for ordinary selection/cleanup: %s", async (active) => {
        await overlayWindowApi.setCaptureInputActive(active);
        expect(invoke).toHaveBeenCalledWith("set_capture_input_active", {
            active, longCapture: false,
        });
    });

    it("propagates release failure so activation rolls back rather than sampling blocked input", async () => {
        invoke.mockRejectedValueOnce(new Error("input handoff failed"));
        await expect(overlayWindowApi.setCaptureInputActive(false, true)).rejects.toThrow("input handoff failed");
    });
});
