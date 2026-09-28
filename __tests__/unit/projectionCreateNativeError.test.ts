import { afterEach, expect, it, vi } from "vitest";
import { safeInvoke } from "../../src/services/apiTransport";
import { createProjectionWithRecovery } from "../../src/services/projectionCreateRetry";
import { requestProjectionEdit } from "../../src/services/projectionEditApi";
import { projectionEnvelope, projectionResponse, projectionUnit } from "../fixtures/qrProjection";

vi.mock("../../src/services/apiTransport", () => ({ safeInvoke: vi.fn() }));
vi.mock("../../src/services/projectionCreateJournal", async (original) => ({
    ...await original<typeof import("../../src/services/projectionCreateJournal")>(),
    loadPreparedCreate: vi.fn(async () => undefined),
    savePreparedCreate: vi.fn(async (entry: unknown) => entry),
}));
afterEach(() => vi.resetAllMocks());

it("preserves native empty-edit-session errors for source initialization", async () => {
    vi.mocked(safeInvoke).mockRejectedValueOnce("projection_edit_not_found");
    await expect(requestProjectionEdit(projectionUnit().data.qrProjection!,
        { operation: "read", projectionId: projectionEnvelope().projectionId })).rejects.toThrow("projection_edit_not_found");
});

it("creates the first delivery after a native string not-found response through the real API boundary", async () => {
    const envelope = projectionEnvelope();
    const response = { ...projectionResponse(), delivery: { targetDeviceId: "pc3", status: "awaiting_confirmation" } };
    vi.mocked(safeInvoke).mockResolvedValueOnce({ envelope })
        .mockRejectedValueOnce("projection_not_found")
        .mockResolvedValueOnce(response);
    const result = await createProjectionWithRecovery(envelope.serverOrigin, projectionUnit(),
        { deviceId: "pc3", name: "PC3", route: "shared_loom", policy: "confirm" },
        { snapshot: response.snapshot!, digest: response.digest }, () => true);
    expect(result.envelope.projectionId).toBe(envelope.projectionId);
    expect(vi.mocked(safeInvoke).mock.calls.map(([, args]) =>
        (args?.operation as { kind: string }).kind)).toEqual(["prepare_create", "read", "create_prepared"]);
});
