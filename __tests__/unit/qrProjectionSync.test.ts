import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectionSync, type ProjectionSyncDependencies } from "../../src/services/qrProjectionSync";
import { projectionEnvelopeV2, projectionResponse, projectionUnit } from "../fixtures/qrProjection";
import type { ProjectionFrame } from "../../src/services/qrProjectionSnapshot";
import { onProjectionUnitRemoved } from "../../src/services/qrProjectionLifecycle";

const disposals: (() => void)[] = [];
function setup(roles: ("source" | "receiver")[] = ["source", "receiver"], v2 = false) {
    const units = roles.map(projectionUnit);
    let remote = projectionResponse();
    if (v2) {
        remote.envelope = projectionEnvelopeV2();
        for (const unit of units) unit.data.qrProjection!.envelope = projectionEnvelopeV2();
    }
    let generation = 0;
    const request = vi.fn<ProjectionSyncDependencies["request"]>(async (operation) => {
        if (operation.kind === "read") return structuredClone(remote);
        if (operation.kind !== "update") throw new Error("Unexpected operation");
        expect(operation.priorRevision).toBe(remote.revision);
        remote = { ...projectionResponse(operation.revision, atob(operation.snapshot.imageBase64)), envelope: remote.envelope };
        return structuredClone(remote);
    });
    const render = vi.fn<ProjectionSyncDependencies["render"]>(async (unit) => ({
        snapshot: { imageBase64: btoa(unit.data.src!), width: 1, height: 1 }, digest: unit.data.src!.repeat(64),
    }));
    const patch = vi.fn<ProjectionSyncDependencies["patch"]>((id, link, imageBase64) => {
        const unit = units.find((item) => item.id === id)!;
        unit.data = { ...unit.data, qrProjection: link, ...(imageBase64 ? { src: atob(imageBase64) } : {}) };
    });
    const unlink = vi.fn().mockResolvedValue(undefined);
    const deps: ProjectionSyncDependencies = { units: () => units, generation: () => generation,
        onUnitRemoved: onProjectionUnitRemoved,
        signature: (unit) => unit.data.src!, render, request, patch, unlink, status: vi.fn() };
    const sync = createProjectionSync(deps);
    disposals.push(sync.dispose);
    return { units, request, render, patch, unlink, sync, remote: () => remote, deps,
        replace: () => { generation += 1; }, update: () => request.mock.calls.filter(([op]) => op.kind === "update") };
}

describe("QR projection continuous synchronization", () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); });
    afterEach(() => { disposals.splice(0).forEach((dispose) => dispose()); vi.useRealTimers(); });

    it.each([false, true])("propagates two source changes with local layout preserved (v2=%s)", async (v2) => {
        const h = setup(undefined, v2);
        await vi.advanceTimersByTimeAsync(1000);
        expect(h.update()).toHaveLength(0);
        for (const pixel of ["b", "c"]) {
            h.units[0].data.src = pixel;
            await vi.advanceTimersByTimeAsync(2500);
            expect(h.units[1].data.src).toBe(pixel);
        }
        expect(h.units[1]).toMatchObject({ x: 40, y: 60, w: 120, h: 100, data: { opacityNormal: 0.5 } });
        expect(h.update()).toHaveLength(2);
        expect(h.remote().revision).toBe(3);
        expect(h.request.mock.calls.every(([, , protocol]) => protocol === h.remote().envelope.protocol)).toBe(true);
        await vi.advanceTimersByTimeAsync(4000);
        expect(h.update()).toHaveLength(2);
    });

    it("coalesces edits during rasterization and has one request in flight per link", async () => {
        const h = setup(["source"]);
        await vi.advanceTimersByTimeAsync(0);
        h.units[0].data.src = "b";
        let resolve!: (frame: ProjectionFrame) => void;
        h.render.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
        await vi.advanceTimersByTimeAsync(1000);
        h.units[0].data.src = "c";
        const reads = h.request.mock.calls.length;
        await vi.advanceTimersByTimeAsync(5000);
        expect(h.request).toHaveBeenCalledTimes(reads);
        resolve({ snapshot: { imageBase64: btoa("b"), width: 1, height: 1 }, digest: "b".repeat(64) });
        await vi.advanceTimersByTimeAsync(2000);
        expect(h.update()).toHaveLength(1);
        expect(h.remote().digest).toBe("c".repeat(64));
    });

    it("recovers a lost update reply by reading the remote revision without uploading twice", async () => {
        const h = setup(["source"]);
        await vi.advanceTimersByTimeAsync(0);
        const original = h.request.getMockImplementation()!;
        h.request.mockImplementation(async (...args) => {
            const response = await original(...args);
            if (args[0].kind === "update") throw new Error("projection_network_error");
            return response;
        });
        h.units[0].data.src = "b";
        await vi.advanceTimersByTimeAsync(4000);
        expect(h.update()).toHaveLength(1);
        expect(h.units[0].data.qrProjection?.revision).toBe(2);
        h.sync.dispose();
        const restored = createProjectionSync(h.deps);
        disposals.push(restored.dispose);
        await vi.advanceTimersByTimeAsync(2000);
        expect(h.update()).toHaveLength(1);
    });

    it.each(["replace", "dispose", "stop"])("discards late pixels after %s", async (action) => {
        const h = setup(["receiver"]);
        await vi.advanceTimersByTimeAsync(0);
        let resolve!: (response: ReturnType<typeof projectionResponse>) => void;
        h.request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
        await vi.advanceTimersByTimeAsync(1000);
        if (action === "replace") h.replace();
        if (action === "dispose") h.sync.dispose();
        if (action === "stop") h.units[0].data.qrProjection!.stopPending = true;
        resolve(projectionResponse(2, "b"));
        await vi.advanceTimersByTimeAsync(0);
        expect(h.patch).not.toHaveBeenCalled();
        expect(h.units[0].data.src).toBe("a");
    });

    it("persists an offline unlink, retries it, and never replaces the last image", async () => {
        const h = setup(["receiver"]);
        await vi.advanceTimersByTimeAsync(0);
        h.units[0].data.qrProjection!.stopPending = true;
        h.unlink.mockRejectedValueOnce(new Error("projection_network_error"));
        h.sync.retry("receiver");
        await vi.advanceTimersByTimeAsync(0);
        expect(h.units[0].data.qrProjection?.stopPending).toBe(true);
        await vi.advanceTimersByTimeAsync(2000);
        expect(h.unlink).toHaveBeenCalledTimes(2);
        expect(h.units[0].data.qrProjection).toBeUndefined();
        expect(h.units[0].data.src).toBe("a");
    });

    it("pauses old-account links but allows explicit local unlink without adopting the old identity", async () => {
        const h = setup(["receiver"], true);
        await vi.advanceTimersByTimeAsync(0);
        h.request.mockRejectedValue(new Error("projection_account_mismatch"));
        await vi.advanceTimersByTimeAsync(1000);
        expect(h.units[0].data.qrProjection?.stopped).not.toBe(true);
        h.units[0].data.qrProjection!.stopPending = true;
        h.unlink.mockRejectedValue(new Error("projection_account_mismatch"));
        h.sync.retry("receiver");
        await vi.advanceTimersByTimeAsync(0);
        expect(h.units[0].data.qrProjection).toBeUndefined();
        expect(h.units[0].data.src).toBe("a");
    });

    it("stops revoked associations and ignores copied links", async () => {
        const h = setup(["receiver"]);
        await vi.advanceTimersByTimeAsync(0);
        h.request.mockRejectedValue(new Error("projection_source_revoked"));
        await vi.advanceTimersByTimeAsync(1000);
        expect(h.units[0].data.qrProjection).toMatchObject({ stopped: true, stopReason: "projection_source_revoked" });
        const reads = h.request.mock.calls.length;
        const copy = projectionUnit(); copy.id = "copied";
        h.units.push(copy);
        await vi.advanceTimersByTimeAsync(60000);
        expect(h.request).toHaveBeenCalledTimes(reads);
    });

    it("rejects a different signed source or revision rollback before applying pixels", async () => {
        const h = setup(["receiver"]);
        await vi.advanceTimersByTimeAsync(0);
        const forged = projectionResponse(2, "b");
        forged.envelope.source.sessionId = "other-session";
        h.request.mockResolvedValue(forged);
        await vi.advanceTimersByTimeAsync(1000);
        expect(h.patch).not.toHaveBeenCalled();
        expect(h.units[0].data.src).toBe("a");
        expect(h.deps.status).toHaveBeenLastCalledWith("receiver", { phase: "retrying", error: "projection_invalid_response" });
    });
});
