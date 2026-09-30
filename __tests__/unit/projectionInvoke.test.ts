import { afterEach, expect, it, vi } from "vitest";
import { safeInvoke } from "../../src/services/apiTransport";
import { projectionInvoke } from "../../src/services/projectionInvoke";
import { projectionError } from "../../src/services/qrProjectionProtocol";

vi.mock("../../src/services/apiTransport", () => ({ safeInvoke: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it("waits for the native gate then submits the exact same QR creation request", async () => {
    vi.useFakeTimers();
    const args = { operation: { kind: "create", unitId: "source" }, serverOrigin: "https://loom.example.test" };
    vi.mocked(safeInvoke).mockRejectedValueOnce("projection_busy").mockRejectedValueOnce(new Error("projection_busy")).mockResolvedValueOnce({ created: true });
    const result = projectionInvoke("projection_request", args);
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toEqual({ created: true });
    expect(safeInvoke).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(safeInvoke).mock.calls) expect(call).toEqual(["projection_request", args]);
});

it.each(["projection_transport_failed", "projection_pairing_required", "projection_invalid_response"])("never replays %s", async (code) => {
    vi.mocked(safeInvoke).mockRejectedValue(code);
    await expect(projectionInvoke("projection_request", { operation: { kind: "create" } })).rejects.toThrow(code);
    expect(safeInvoke).toHaveBeenCalledTimes(1);
});

it("bounds persistent contention and reports busy without blaming the network", async () => {
    vi.useFakeTimers(); vi.mocked(safeInvoke).mockRejectedValue("projection_busy");
    const result = projectionInvoke("projection_request", { operation: { kind: "context" } });
    const rejected = expect(result).rejects.toThrow("projection_busy");
    await vi.advanceTimersByTimeAsync(15_000); await rejected;
    expect(safeInvoke).toHaveBeenCalledTimes(61);
    expect(vi.getTimerCount()).toBe(0);
    expect(projectionError(new Error("projection_busy"))).toBe("投射服务正忙，请稍后重试。");
});
