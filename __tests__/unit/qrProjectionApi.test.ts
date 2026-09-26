import { afterEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "../../src/services/apiTransport";
import { requestProjection, unlinkProjection } from "../../src/services/qrProjectionApi";
import { parseProjectionInvitation } from "../../src/services/qrProjectionProtocol";
import { projectionEnvelope, projectionEnvelopeV2, projectionResponse } from "../fixtures/qrProjection";

vi.mock("../../src/services/apiTransport", () => ({ safeInvoke: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("projection version routing", () => {
    it("routes v2 invitations and persisted cleanup only through the local native command", async () => {
        const envelope = projectionEnvelopeV2();
        expect(parseProjectionInvitation(JSON.stringify(envelope))).toEqual(envelope);
        vi.mocked(safeInvoke).mockResolvedValueOnce({ ...projectionResponse(), envelope });
        const operation = { kind: "inspect", envelope } as const;
        await requestProjection(operation);
        expect(safeInvoke).toHaveBeenLastCalledWith("projection_v2_request", { operation });
        vi.mocked(safeInvoke).mockResolvedValueOnce({ unlinked: true });
        await unlinkProjection(envelope.projectionId, envelope.serverOrigin, envelope.protocol);
        expect(safeInvoke).toHaveBeenLastCalledWith("projection_v2_request", {
            operation: { kind: "unlink", projectionId: envelope.projectionId },
        });
    });

    it("keeps saved v1 associations on their original shared Loom origin", async () => {
        const envelope = projectionEnvelope();
        vi.mocked(safeInvoke).mockResolvedValueOnce(projectionResponse());
        const operation = { kind: "read", projectionId: envelope.projectionId, knownRevision: 1 } as const;
        await requestProjection(operation, envelope.serverOrigin, envelope.protocol);
        expect(safeInvoke).toHaveBeenLastCalledWith("projection_request", { operation, serverOrigin: envelope.serverOrigin });
    });
});
