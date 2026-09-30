import { afterEach, expect, it, vi } from "vitest";
import { projectionEnvelope } from "../fixtures/qrProjection";

afterEach(() => { vi.useRealTimers(); localStorage.clear(); vi.restoreAllMocks(); vi.resetModules(); });

it("rejects an overflowing multi-target deletion without partially unlinking the live source", async () => {
    localStorage.clear(); vi.resetModules();
    const cleanup = await import("../../src/services/qrProjectionCleanup");
    const entry = (id: number) => ({ envelope: { ...projectionEnvelope(), projectionId: `projection:${id.toString(16).padStart(32, "0")}` } });
    cleanup.queueProjectionUnlinks(Array.from({ length: 127 }, (_, id) => entry(id)));
    const before = localStorage.getItem("hook.qr-projection.pending-unlinks.v1");
    expect(() => cleanup.queueProjectionUnlinks([entry(127), entry(128)])).toThrow("projection_cleanup_limit");
    expect(localStorage.getItem("hook.qr-projection.pending-unlinks.v1")).toBe(before);
    cleanup.queueProjectionUnlinks([entry(127), entry(127)]);
    expect(JSON.parse(localStorage.getItem("hook.qr-projection.pending-unlinks.v1")!)).toHaveLength(128);
});

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
        await vi.advanceTimersByTimeAsync(0);
        cleanup.queueProjectionUnlink(projectionEnvelope());
        resolve();
        await vi.advanceTimersByTimeAsync(1000);
        expect(unlink).toHaveBeenCalledTimes(2);
    } finally { owner.dispose(); }
});

it("recovers durable cancellation without a localStorage queue and preserves active creates", async () => {
    vi.useFakeTimers();
    const journal = await import("../../src/services/projectionCreateJournal");
    const envelope = projectionEnvelope();
    vi.spyOn(journal, "loadCancelledCreates").mockResolvedValue([{
        key: "cancelled", origin: envelope.serverOrigin, unitId: envelope.source.unitId,
        targetDeviceId: "receiver", envelope, snapshot: { imageBase64: "unused", width: 1, height: 1 }, cancelled: true,
    }]);
    const forget = vi.spyOn(journal, "forgetPreparedProjection").mockResolvedValue();
    const cleanup = await import("../../src/services/qrProjectionCleanup");
    const unlink = vi.fn().mockResolvedValue(undefined);
    const owner = cleanup.createProjectionCleanup(unlink);
    try {
        await vi.advanceTimersByTimeAsync(0);
        expect(unlink).toHaveBeenCalledTimes(1);
        expect(unlink).toHaveBeenCalledWith(envelope.projectionId, envelope.serverOrigin, envelope.protocol);
        expect(forget).toHaveBeenCalledWith(envelope.serverOrigin, envelope.projectionId);
        expect(JSON.parse(localStorage.getItem("hook.qr-projection.pending-unlinks.v1")!)).toEqual([]);
    } finally { owner.dispose(); }
});
