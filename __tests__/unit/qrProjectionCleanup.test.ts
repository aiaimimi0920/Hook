import { afterEach, expect, it, vi } from "vitest";
import { projectionEnvelope } from "../fixtures/qrProjection";

afterEach(() => { vi.useRealTimers(); localStorage.clear(); vi.resetModules(); });

it("persists cancelled acceptance cleanup and retries it after restart without another unit", async () => {
    vi.useFakeTimers();
    localStorage.clear();
    const first = await import("../../src/services/qrProjectionCleanup");
    first.queueProjectionUnlink(projectionEnvelope());
    vi.resetModules();
    const restored = await import("../../src/services/qrProjectionCleanup");
    const unlink = vi.fn().mockRejectedValueOnce(new Error("projection_network_error")).mockResolvedValue(undefined);
    const owner = restored.createProjectionCleanup(unlink);
    try {
        await vi.advanceTimersByTimeAsync(0);
        expect(unlink).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(3000);
        expect(unlink).toHaveBeenCalledTimes(2);
        expect(JSON.parse(localStorage.getItem("hook.qr-projection.pending-unlinks.v1")!)).toEqual([]);
    } finally { owner.dispose(); }
});

it("does not let an early unlink response discard cleanup queued by late acceptance", async () => {
    vi.useFakeTimers();
    const cleanup = await import("../../src/services/qrProjectionCleanup");
    cleanup.queueProjectionUnlink(projectionEnvelope());
    let resolve!: () => void;
    const unlink = vi.fn().mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; })).mockResolvedValue(undefined);
    const owner = cleanup.createProjectionCleanup(unlink);
    try {
        cleanup.queueProjectionUnlink(projectionEnvelope());
        resolve();
        await vi.advanceTimersByTimeAsync(1000);
        expect(unlink).toHaveBeenCalledTimes(2);
    } finally { owner.dispose(); }
});
