import { describe, expect, it, vi } from "vitest";

import { refreshLoomHookCapabilitiesOnStartup } from "../../src/services/loomHookStartup";

describe("refreshLoomHookCapabilitiesOnStartup", () => {
    it("refreshes capabilities exactly once even for a standalone startup profile", async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);

        const refreshed = await refreshLoomHookCapabilitiesOnStartup(refresh);

        expect(refreshed).toBe(true);
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
