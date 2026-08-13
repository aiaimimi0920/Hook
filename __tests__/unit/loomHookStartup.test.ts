import { describe, expect, it, vi } from "vitest";

import { refreshLoomHookCapabilitiesOnStartup } from "../../src/services/loomHookStartup";

describe("refreshLoomHookCapabilitiesOnStartup", () => {
    it("skips capability refresh when Loom Hook is disabled", async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);

        const refreshed = await refreshLoomHookCapabilitiesOnStartup(false, refresh);

        expect(refreshed).toBe(false);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("refreshes capabilities exactly once when Loom Hook is enabled", async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);

        const refreshed = await refreshLoomHookCapabilitiesOnStartup(true, refresh);

        expect(refreshed).toBe(true);
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
