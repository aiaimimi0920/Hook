import { afterEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ProjectionTargetPicker } from "../../src/components/ProjectionTargetPicker";
import { deliveryTargets } from "../../src/services/projectionDeliveryApi";
import { safeInvoke } from "../../src/services/apiTransport";

vi.mock("../../src/services/apiTransport", () => ({ safeInvoke: vi.fn() }));
const remote = { deviceId: "peer-target:" + "a".repeat(64), name: "PC 3", policy: "confirm",
    route: "offline_peer", peerId: "loom-" + "b".repeat(64), peerName: "Remote Loom",
    remoteDeviceId: "device:pc3", deliveryAvailable: false,
    unavailableReason: "offline_peer_delivery_not_implemented" };
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.resetAllMocks(); });

it("keeps remote directory entries non-sendable while local delivery remains available", async () => {
    vi.mocked(safeInvoke).mockResolvedValue({ peerDirectory: { status: "partial" }, targets: [remote,
        { deviceId: "device:local", name: "Local", policy: "auto", route: "shared_loom" }] });
    const change = vi.fn();
    const directory = await deliveryTargets("https://loom.example.test");
    dispose = render(() => <ProjectionTargetPicker directory={directory} disabled={false} selection={{ devices: [], groups: [] }} change={change} />, document.body);
    const inputs = document.querySelectorAll<HTMLInputElement>("input");
    expect(inputs[0].disabled).toBe(true);
    inputs[0].click();
    expect(change).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Remote Loom");
    expect(document.querySelector('[role="status"]')).not.toBeNull();
    inputs[1].click();
    expect(change).toHaveBeenCalledWith({ devices: ["device:local"], groups: [] });
});

it.each([{ deliveryAvailable: true }, { route: "shared_loom" }, { peerId: "invalid" }])(
    "rejects malformed remote routing metadata %j", async (change) => {
        vi.mocked(safeInvoke).mockResolvedValue({ targets: [{ ...remote, ...change }] });
        await expect(deliveryTargets("https://loom.example.test")).rejects.toThrow("projection_invalid_response");
    });
