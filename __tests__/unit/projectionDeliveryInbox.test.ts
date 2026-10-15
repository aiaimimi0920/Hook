import { afterEach, expect, it, vi } from "vitest";
import { safeInvoke } from "../../src/services/apiTransport";
import { deliveryInbox } from "../../src/services/projectionDeliveryApi";
import { projectionEnvelope } from "../fixtures/qrProjection";

vi.mock("../../src/services/apiTransport", () => ({ safeInvoke: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const inbox = () => ({ offlinePeers: true, invitations: [{ envelope: projectionEnvelope(),
    revision: 1, digest: "a".repeat(64), sourceName: "PC 1", receivePolicy: "confirm",
    delivery: { status: "awaiting_confirmation" } }] });

it("retains shared-Loom invitations when LAN rejects the optional offline-peer route", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(inbox()).mockRejectedValueOnce("lan_request_rejected");
    const items = await deliveryInbox(projectionEnvelope().serverOrigin, "confirm");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sourceName: "PC 1", receivePolicy: "confirm", accepted: false });
    expect(safeInvoke).toHaveBeenLastCalledWith("projection_request", {
        operation: { kind: "inbox", policy: "confirm" }, serverOrigin: projectionEnvelope().serverOrigin, offlineRoute: {},
    });
});

it("still rejects a failed or malformed primary inbox instead of inventing an empty success", async () => {
    vi.mocked(safeInvoke).mockRejectedValueOnce("projection_pairing_required");
    await expect(deliveryInbox(projectionEnvelope().serverOrigin, "confirm")).rejects.toBe("projection_pairing_required");
    vi.mocked(safeInvoke).mockResolvedValueOnce({ invitations: [null] });
    await expect(deliveryInbox(projectionEnvelope().serverOrigin, "confirm")).rejects.toThrow("projection_invalid_response");
});

it("merges valid offline invitations and isolates malformed optional data", async () => {
    const peer = { ...inbox().invitations[0], route: "offline_peer", envelope: { ...projectionEnvelope(), serverOrigin: "https://peer.example.test" } };
    vi.mocked(safeInvoke).mockResolvedValueOnce(inbox()).mockResolvedValueOnce({ invitations: [peer] });
    expect(await deliveryInbox(projectionEnvelope().serverOrigin, "confirm")).toHaveLength(2);
    vi.mocked(safeInvoke).mockResolvedValueOnce(inbox()).mockResolvedValueOnce({ invitations: [null] });
    expect(await deliveryInbox(projectionEnvelope().serverOrigin, "confirm")).toHaveLength(1);
});
