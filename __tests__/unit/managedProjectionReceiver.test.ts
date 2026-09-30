import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createManagedProjectionReceiver } from "../../src/services/managedProjectionReceiver";
import { projectionContext } from "../../src/services/qrProjectionApi";
import { deliverySettings, saveDeliverySettings, deliveryPending, setDeliveryPending } from "../../src/store/projectionDeliveryStore";
import { pauseProjectionReceiver } from "../../src/store/managedProjectionReceiverStore";
import { invalidateProjectionWorkspace } from "../../src/services/qrProjectionLifecycle";
import { projectionResponse } from "../fixtures/qrProjection";
vi.mock("../../src/services/qrProjectionApi", () => ({ projectionContext: vi.fn() }));
let manager: ReturnType<typeof createManagedProjectionReceiver> | undefined;
beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(1000); pauseProjectionReceiver(false);
    saveDeliverySettings("https://old.example.test", "auto");
    vi.mocked(projectionContext).mockResolvedValue("https://current.example.test");
});
afterEach(() => { manager?.dispose(); manager = undefined; vi.useRealTimers(); vi.resetAllMocks(); });
it("disables stale manual configuration then follows the current Loom with server-decided policy", async () => {
    manager = createManagedProjectionReceiver(); expect(deliverySettings().policy).toBe("disabled");
    await vi.advanceTimersByTimeAsync(0);
    expect(deliverySettings()).toEqual({ origin: "https://current.example.test", policy: "confirm" });
    setDeliveryPending([{ ...projectionResponse(), sourceName: "old", accepted: false }]);
    vi.mocked(projectionContext).mockResolvedValue("https://new.example.test");
    await vi.advanceTimersByTimeAsync(5000);
    expect(deliverySettings().origin).toBe("https://new.example.test"); expect(deliveryPending()).toHaveLength(0);
});
it.each(["pause", "dispose", "workspace"])("does not enable a late context after %s", async (reason) => {
    let resolve!: (origin: string) => void;
    vi.mocked(projectionContext).mockImplementation(() => new Promise((done) => { resolve = done; }));
    manager = createManagedProjectionReceiver();
    if (reason === "pause") pauseProjectionReceiver(true);
    else if (reason === "dispose") manager.dispose();
    else invalidateProjectionWorkspace();
    resolve("https://late.example.test"); await vi.advanceTimersByTimeAsync(0);
    expect(deliverySettings().policy).toBe("disabled");
});
it("local pause clears invitations immediately and recovery resolves the current Loom again", async () => {
    manager = createManagedProjectionReceiver(); await vi.advanceTimersByTimeAsync(0);
    setDeliveryPending([{ ...projectionResponse(), sourceName: "source", accepted: false }]);
    pauseProjectionReceiver(true); expect(deliveryPending()).toHaveLength(0); expect(deliverySettings().policy).toBe("disabled");
    await vi.advanceTimersByTimeAsync(1000); vi.mocked(projectionContext).mockClear();
    await vi.advanceTimersByTimeAsync(6000); expect(projectionContext).not.toHaveBeenCalled();
    pauseProjectionReceiver(false); await vi.advanceTimersByTimeAsync(1000);
    expect(deliverySettings().policy).toBe("confirm");
});
it("context failures fail closed and workspace replacement can recover without editing connection settings", async () => {
    manager = createManagedProjectionReceiver(); await vi.advanceTimersByTimeAsync(0);
    const original = deliverySettings(); invalidateProjectionWorkspace();
    await vi.advanceTimersByTimeAsync(1000); expect(deliverySettings()).not.toBe(original);
    vi.mocked(projectionContext).mockRejectedValue(new Error("projection_pairing_required"));
    await vi.advanceTimersByTimeAsync(5000); expect(deliverySettings().policy).toBe("disabled");
});
