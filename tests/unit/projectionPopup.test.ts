import { afterEach, expect, it, vi } from "vitest";
import { claimProjectionPopup, dismissProjectionPopup } from "../../src/features/projection/services/projectionPopup";

afterEach(dismissProjectionPopup);

it("closes the old popup and ignores its delayed cleanup after a replacement", () => {
    const first = vi.fn(), second = vi.fn();
    const releaseFirst = claimProjectionPopup(first);
    claimProjectionPopup(second);
    expect(first).toHaveBeenCalledTimes(1);
    releaseFirst();
    dismissProjectionPopup();
    expect(second).toHaveBeenCalledTimes(1);
    dismissProjectionPopup();
    expect(second).toHaveBeenCalledTimes(1);
});

it("does not call a disposed popup when another popup opens", () => {
    const closed = vi.fn();
    claimProjectionPopup(closed)();
    claimProjectionPopup(vi.fn());
    expect(closed).not.toHaveBeenCalled();
});
