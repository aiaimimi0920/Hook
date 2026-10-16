import { describe, expect, it, vi } from "vitest";

import { refreshLoomOtterCapabilitiesOnStartup } from "../../src/integrations/loom/loomOtterStartup";

describe("refreshLoomOtterCapabilitiesOnStartup", () => {
    it("does not connect when integration is disabled or unknown", async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);
        expect(await refreshLoomOtterCapabilitiesOnStartup(refresh)).toBe(false);
        expect(await refreshLoomOtterCapabilitiesOnStartup(refresh, false)).toBe(false);
        expect(refresh).not.toHaveBeenCalled();
    });

    it("refreshes capabilities exactly once when explicitly enabled", async () => {
        const refresh = vi.fn().mockResolvedValue(undefined);

        const refreshed = await refreshLoomOtterCapabilitiesOnStartup(refresh, true);

        expect(refreshed).toBe(true);
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
