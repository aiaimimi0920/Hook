import { afterEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ProjectionDeviceTargets } from "../../src/components/ProjectionDeviceTargets";
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
    const send = vi.fn();
    dispose = render(() => <ProjectionDeviceTargets origin="https://loom.example.test" busy={false} send={send} />, document.body);
    const button = (label: string) => [...document.querySelectorAll("button")].find((item) => item.textContent?.includes(label))!;
    button("刷新").click();
    await vi.waitFor(() => expect(button("远端设备")).toBeDefined());
    expect(button("远端设备").disabled).toBe(true);
    button("远端设备").click();
    expect(send).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("来自 Remote Loom");
    expect(document.querySelector('[role="status"]')).not.toBeNull();
    button("投送到 Local").click();
    expect(send).toHaveBeenCalledWith("device:local");
});

it.each([{ deliveryAvailable: true }, { route: "shared_loom" }, { peerId: "invalid" }])(
    "rejects malformed remote routing metadata %j", async (change) => {
        vi.mocked(safeInvoke).mockResolvedValue({ targets: [{ ...remote, ...change }] });
        await expect(deliveryTargets("https://loom.example.test")).rejects.toThrow("projection_invalid_response");
    });
