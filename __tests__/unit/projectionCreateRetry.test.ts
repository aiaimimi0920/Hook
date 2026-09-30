import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectionWithRecovery } from "../../src/services/projectionCreateRetry";
import { prepareProjectionCreate, requestProjection } from "../../src/services/qrProjectionApi";
import { loadPreparedCreate, savePreparedCreate, type PreparedProjectionCreate } from "../../src/services/projectionCreateJournal";
import { queueProjectionUnlink } from "../../src/services/qrProjectionCleanup";
import { projectionResponse, projectionUnit } from "../fixtures/qrProjection";
const records = vi.hoisted(() => new Map<string, PreparedProjectionCreate>());
vi.mock("../../src/services/qrProjectionApi", () => ({ prepareProjectionCreate: vi.fn(), requestProjection: vi.fn() }));
vi.mock("../../src/services/qrProjectionCleanup", () => ({ queueProjectionUnlink: vi.fn() }));
vi.mock("../../src/services/projectionCreateJournal", async (original) => ({
    ...await original<typeof import("../../src/services/projectionCreateJournal")>(),
    loadPreparedCreate: vi.fn(async (key: string) => records.get(key)),
    savePreparedCreate: vi.fn(async (entry: PreparedProjectionCreate) => { records.set(entry.key, structuredClone(entry)); return entry; }),
    cancelPreparedCreate: vi.fn(async (key: string) => { records.get(key)!.cancelled = true; }),
}));
const origin = "https://loom.example.test";
const source = projectionUnit();
const target = { deviceId: "pc3", name: "PC3", route: "shared_loom" as const, policy: "confirm" as const };
const frame = { snapshot: { imageBase64: btoa("a"), width: 1, height: 1 }, digest: "a".repeat(64) };
let remote: ReturnType<typeof projectionResponse> | undefined;
const run = (current = () => true) => createProjectionWithRecovery(origin, source, target, frame, current);
const creates = () => vi.mocked(requestProjection).mock.calls.filter(([op]) => op.kind === "create_prepared");
beforeEach(() => {
    remote = undefined;
    vi.mocked(prepareProjectionCreate).mockResolvedValue(projectionResponse().envelope);
    vi.mocked(requestProjection).mockImplementation(async (operation) => {
        if (operation.kind === "read") { if (!remote) throw new Error("projection_not_found"); return structuredClone(remote); }
        if (operation.kind !== "create_prepared") throw new Error("unexpected operation");
        expect(records.size).toBe(1);
        remote = { ...projectionResponse(), envelope: operation.envelope,
            delivery: { targetDeviceId: "pc3", status: "accepted" } };
        return structuredClone(remote);
    });
});
afterEach(() => { records.clear(); vi.resetAllMocks(); });

it("waits for durable commit before issuing any network request", async () => {
    let commit!: () => void;
    vi.mocked(savePreparedCreate).mockImplementationOnce((entry) => new Promise((resolve) => {
        commit = () => { records.set(entry.key, entry); resolve(entry); };
    }));
    const task = run(); await vi.waitFor(() => expect(commit).toBeDefined());
    expect(requestProjection).not.toHaveBeenCalled(); commit(); await task;
    expect(creates()).toHaveLength(1);
});

it("recovers a committed create whose response was lost without creating another invitation", async () => {
    const original = vi.mocked(requestProjection).getMockImplementation()!;
    vi.mocked(requestProjection).mockImplementation(async (...args) => {
        const response = await original(...args);
        if (args[0].kind === "create_prepared") throw new Error("projection_transport_failed");
        return response;
    });
    const result = await run(); expect(result.envelope.projectionId).toBe(remote!.envelope.projectionId);
    await run(); expect(creates()).toHaveLength(1); expect(prepareProjectionCreate).toHaveBeenCalledTimes(1);
});

it("retains the original pixels and signed identity through an ambiguous failure and retry", async () => {
    const original = vi.mocked(requestProjection).getMockImplementation()!;
    vi.mocked(requestProjection).mockImplementationOnce(async () => { throw new Error("projection_not_found"); })
        .mockImplementationOnce(async () => { throw new Error("projection_transport_failed"); });
    await expect(run()).rejects.toThrow("projection_transport_failed");
    vi.mocked(requestProjection).mockImplementation(original);
    await createProjectionWithRecovery(origin, source, target, { ...frame, snapshot: { ...frame.snapshot, imageBase64: btoa("b") } }, () => true);
    expect(prepareProjectionCreate).toHaveBeenCalledTimes(1);
    expect(creates().map(([op]) => "snapshot" in op && op.snapshot.imageBase64)).toEqual([btoa("a"), btoa("a")]);
    expect(creates().map(([op]) => "envelope" in op && op.envelope)).toEqual([projectionResponse().envelope, projectionResponse().envelope]);
});

it("does not publish when request storage is unavailable", async () => {
    vi.mocked(savePreparedCreate).mockRejectedValueOnce(new Error("projection_create_storage_unavailable"));
    await expect(run()).rejects.toThrow("projection_create_storage_unavailable");
    expect(requestProjection).not.toHaveBeenCalled();
});

it("serializes concurrent retries for the same target and rejects mismatched recovered identity", async () => {
    await Promise.all([run(), run()]); expect(creates()).toHaveLength(1);
    remote!.delivery!.targetDeviceId = "another-device";
    await expect(run()).rejects.toThrow("projection_invalid_response"); expect(creates()).toHaveLength(1);
});

it("cancels the durable intent and queues cleanup even when a late create and reconciliation both fail", async () => {
    let current = true;
    vi.mocked(requestProjection).mockImplementationOnce(async () => { throw new Error("projection_not_found"); })
        .mockImplementationOnce(async () => { current = false; throw new Error("projection_transport_failed"); });
    await expect(run(() => current)).rejects.toThrow("projection_transport_failed");
    expect([...records.values()][0].cancelled).toBe(true); expect(queueProjectionUnlink).toHaveBeenCalledTimes(1);
    await expect(run()).rejects.toThrow("projection_create_cancelled"); expect(prepareProjectionCreate).toHaveBeenCalledTimes(1);
});

it("fails closed on a corrupted persisted intent instead of preparing another identity", async () => {
    vi.mocked(loadPreparedCreate).mockRejectedValueOnce(new Error("projection_create_storage_unavailable"));
    await expect(run()).rejects.toThrow("projection_create_storage_unavailable");
    expect(prepareProjectionCreate).not.toHaveBeenCalled(); expect(requestProjection).not.toHaveBeenCalled();
});
