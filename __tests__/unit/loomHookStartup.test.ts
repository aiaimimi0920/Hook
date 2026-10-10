import { describe, expect, it, vi } from "vitest";

import { refreshLoomHookCapabilitiesOnStartup } from "../../src/services/loomHookStartup";

describe("refreshLoomHookCapabilitiesOnStartup", () => {
    it("does not connect when integration is disabled or unknown", async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        expect(await refreshLoomHookCapabilitiesOnStartup(refresh)).toBe(false);
        expect(await refreshLoomHookCapabilitiesOnStartup(refresh, false)).toBe(false);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("refreshes capabilities exactly once when explicitly enabled", async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);

        const refreshed = await refreshLoomHookCapabilitiesOnStartup(refresh, true);

        expect(refreshed).toBe(true);
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
