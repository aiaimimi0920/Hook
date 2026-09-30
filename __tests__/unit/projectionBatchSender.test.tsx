import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ProjectionBatchSender } from "../../src/components/ProjectionBatchSender";
import { graphStore } from "../../src/store/graphStore";
import { prepareProjectionCreate, projectionContext, requestProjection } from "../../src/services/qrProjectionApi";
import { deliveryTargets, type DeliveryDirectory } from "../../src/services/projectionDeliveryApi";
import { renderProjectionFrame } from "../../src/services/qrProjectionSnapshot";
import { queueProjectionUnlink } from "../../src/services/qrProjectionCleanup";
import { projectionResponse, projectionUnit } from "../fixtures/qrProjection";
import type { PreparedProjectionCreate } from "../../src/services/projectionCreateJournal";
const journal = vi.hoisted(() => new Map<string, PreparedProjectionCreate>());
vi.mock("../../src/services/projectionCreateJournal", async (original) => ({
    ...await original<typeof import("../../src/services/projectionCreateJournal")>(),
    loadPreparedCreate: vi.fn(async (key: string) => journal.get(key)),
    savePreparedCreate: vi.fn(async (entry: PreparedProjectionCreate) => { journal.set(entry.key, entry); return entry; }),
    cancelPreparedCreate: vi.fn(async (key: string) => { const entry = journal.get(key); if (entry) entry.cancelled = true; }),
}));

vi.mock("../../src/services/qrProjectionApi", () => ({ prepareProjectionCreate: vi.fn(), projectionContext: vi.fn(), requestProjection: vi.fn() }));
vi.mock("../../src/services/projectionDeliveryApi", () => ({ deliveryTargets: vi.fn() }));
vi.mock("../../src/services/qrProjectionSnapshot", () => ({ renderProjectionFrame: vi.fn() }));
vi.mock("../../src/services/projectionEditJournal", () => ({
    loadProjectionEdit: async () => undefined, saveProjectionEdit: vi.fn(), forgetProjectionEdit: async () => undefined,
}));
vi.mock("../../src/services/qrProjectionCleanup", () => ({ queueProjectionUnlinks: vi.fn(), queueProjectionUnlink: vi.fn() }));
vi.mock("../../src/services/syncService", () => ({ syncService: { performWorkflowSync: vi.fn().mockResolvedValue(undefined) } }));

const origin = "https://loom.example.test";
const directory: DeliveryDirectory = {
    status: "complete", targets: [
        { deviceId: "pc2", name: "PC2", policy: "confirm", route: "shared_loom" },
        { deviceId: "peer-target:" + "a".repeat(64), name: "PC3", policy: "auto", route: "offline_peer", peerId: "loom-" + "b".repeat(64),
            peerName: "Other", remoteDeviceId: "pc3", deliveryAvailable: true },
    ], groups: [{ groupId: "team", name: "Team", targetIds: ["pc2", "peer-target:" + "a".repeat(64)], unavailableCount: 0 }],
};
let dispose: (() => void) | undefined;
const send = () => document.querySelector<HTMLButtonElement>('button[aria-label^="投射到"]')!;
const mount = async () => {
    const unit = projectionUnit(); unit.data.qrProjection = undefined;
    graphStore.actions.addUnit(unit);
    dispose = render(() => <ProjectionBatchSender unitId="source" retry={vi.fn()} />, document.body);
    await vi.waitFor(() => expect(document.querySelectorAll("input")).toHaveLength(3));
};
beforeEach(() => {
    vi.mocked(projectionContext).mockResolvedValue(origin);
    vi.mocked(deliveryTargets).mockResolvedValue(directory);
    vi.mocked(renderProjectionFrame).mockResolvedValue({ digest: "a".repeat(64), snapshot: { imageBase64: btoa("a"), width: 1, height: 1 } });
    vi.mocked(prepareProjectionCreate).mockImplementation(async (operation) => {
        const envelope = projectionResponse().envelope;
        envelope.projectionId = "projection:" + (operation.targetDeviceId === "pc2" ? "1" : "2").repeat(32);
        return envelope;
    });
    vi.mocked(requestProjection).mockImplementation(async (operation, _origin, _protocol, offline) => {
        if (operation.kind === "read") throw new Error("projection_not_found");
        if (operation.kind !== "create_prepared") throw new Error("unexpected operation");
        const response = projectionResponse();
        response.envelope.projectionId = "projection:" + (offline ? "2" : "1").repeat(32);
        if (offline) response.offlineTransport = offline;
        return response;
    });
});
afterEach(() => { dispose?.(); graphStore.actions.replaceUnits([]); document.body.replaceChildren(); journal.clear(); vi.resetAllMocks(); });
const creates = () => vi.mocked(requestProjection).mock.calls.filter(([operation]) => operation.kind === "create_prepared");

it("deduplicates a device plus its group, renders once and retains both local/peer associations", async () => {
    await mount();
    const boxes = document.querySelectorAll<HTMLInputElement>("input");
    boxes[0].click(); boxes[2].click();
    expect(send().getAttribute("aria-label")).toBe("投射到 2 台设备");
    send().click();
    await vi.waitFor(() => expect(graphStore.units[0].data.projectionSenders).toHaveLength(2));
    expect(renderProjectionFrame).toHaveBeenCalledTimes(1);
    expect(creates()).toHaveLength(2);
    expect(graphStore.units[0].data.qrProjection).toBeUndefined();
    expect(requestProjection).toHaveBeenCalledWith(expect.objectContaining({ targetDeviceId: directory.targets[1].deviceId }), origin,
        "neuro.qr-projection.v1", { origin }, { peerId: "loom-" + "b".repeat(64), remoteDeviceId: "pc3" });
    await vi.waitFor(() => expect(send().disabled).toBe(false));
    send().click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("未重复创建"));
    expect(creates()).toHaveLength(2);
});

it("retries a partial create without creating another association for the successful target", async () => {
    vi.mocked(requestProjection).mockRejectedValueOnce(new Error("projection_target_offline"));
    await mount(); document.querySelectorAll<HTMLInputElement>("input")[2].click(); send().click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("接收设备已离线"));
    expect(graphStore.units[0].data.projectionSenders).toHaveLength(1);
    await vi.waitFor(() => expect(send().disabled).toBe(false)); send().click();
    await vi.waitFor(() => expect(graphStore.units[0].data.projectionSenders).toHaveLength(2));
    expect(creates()).toHaveLength(2);
});

it("refreshes the directory at send time and does not send a vanished group member", async () => {
    await mount(); document.querySelectorAll<HTMLInputElement>("input")[2].click();
    vi.mocked(deliveryTargets).mockResolvedValue({ ...directory, targets: [directory.targets[0]], groups: [{ ...directory.groups![0], targetIds: ["pc2"], unavailableCount: 1 }] });
    send().click();
    await vi.waitFor(() => expect(graphStore.units[0].data.projectionSenders).toHaveLength(1));
    expect(creates()).toHaveLength(1);
    expect(document.body.textContent).toContain("1 项设备或组成员不可用");
});

it("cleans up every late create after deleting the source and reusing its ID", async () => {
    const complete: ((response: ReturnType<typeof projectionResponse>) => void)[] = [];
    vi.mocked(requestProjection).mockImplementation(() => new Promise((resolve) => complete.push(resolve)));
    await mount(); document.querySelectorAll<HTMLInputElement>("input")[2].click(); send().click();
    await vi.waitFor(() => expect(complete).toHaveLength(2));
    graphStore.actions.removeUnit("source"); const replacement = projectionUnit(); replacement.data.qrProjection = undefined;
    graphStore.actions.addUnit(replacement);
    for (const resolve of complete) resolve(projectionResponse());
    await vi.waitFor(() => expect(queueProjectionUnlink).toHaveBeenCalledTimes(2));
    expect(graphStore.units[0].data.projectionSenders).toBeUndefined();
});

it("clears selection if the configured Loom changes before sending", async () => {
    await mount(); document.querySelectorAll<HTMLInputElement>("input")[0].click();
    vi.mocked(projectionContext).mockResolvedValue("https://other.example.test"); send().click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("当前 Loom 已变化"));
    expect(requestProjection).not.toHaveBeenCalled();
});
