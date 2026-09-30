import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { useProjectionTargetControls } from "../../src/hooks/useProjectionTargetControls";
import { ProjectionPropertyBar } from "../../src/components/ProjectionPropertyBar";
import { graphStore } from "../../src/store/graphStore";
import { projectionStatuses, setProjectionStatuses } from "../../src/store/qrProjectionStore";
import { projectionContext, unlinkProjection } from "../../src/services/qrProjectionApi";
import { deliveryTargets, type DeliveryDirectory } from "../../src/services/projectionDeliveryApi";
import { createProjectionWithRecovery } from "../../src/services/projectionCreateRetry";
import { renderProjectionFrame } from "../../src/services/qrProjectionSnapshot";
import { cancelPreparedCreate, loadPreparedCreate } from "../../src/services/projectionCreateJournal";
import { createProjectionSync } from "../../src/services/qrProjectionSync";
import { patchProjection, saveProjectionSenders } from "../../src/services/qrProjectionSession";
import { projectionBindingKey, projectionBindingStatusKey } from "../../src/services/projectionSenderBindings";
import { extraRects } from "../../src/services/uiRegistry";
import { projectionResponse, projectionUnit } from "../fixtures/qrProjection";

vi.mock("../../src/services/qrProjectionApi", () => ({ projectionContext: vi.fn(), unlinkProjection: vi.fn() }));
vi.mock("../../src/services/projectionDeliveryApi", () => ({ deliveryTargets: vi.fn() }));
vi.mock("../../src/services/projectionCreateRetry", () => ({ createProjectionWithRecovery: vi.fn() }));
vi.mock("../../src/services/qrProjectionSnapshot", () => ({ renderProjectionFrame: vi.fn() }));
vi.mock("../../src/services/projectionEditSession", async (original) => {
    const actual = await original<typeof import("../../src/services/projectionEditSession")>();
    return { ...actual, projectionEditing: { ...actual.projectionEditing,
        sendFrame: (_id: string, render: () => Promise<unknown>) => render(),
    } };
});
vi.mock("../../src/services/projectionCreateJournal", async (original) => ({
    ...await original<typeof import("../../src/services/projectionCreateJournal")>(),
    loadPreparedCreate: vi.fn(), cancelPreparedCreate: vi.fn(),
}));
vi.mock("../../src/services/syncService", () => ({ syncService: {
    updateBackendRects: async () => undefined, performWorkflowSync: async () => undefined,
} }));
const origin = "https://loom.example.test";
const directory: DeliveryDirectory = { status: "complete", targets: [
    { deviceId: "pc2", name: "PC2", route: "shared_loom", policy: "confirm" },
    { deviceId: "pc3", name: "PC3", route: "shared_loom", policy: "auto" },
], groups: [{ groupId: "team", name: "Team", targetIds: ["pc2", "pc3"], unavailableCount: 0 }] };
let dispose: () => void;
let sync: ReturnType<typeof createProjectionSync> | undefined;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const box = (id = "pc2") => document.querySelector<HTMLInputElement>(`input[aria-label="${id} 投射开关"]`)!;
const marker = (id = "pc2") => document.querySelector<HTMLElement>(`[data-projection-target="${id}"] [role="status"]`)!;
const bindings = () => graphStore.units[0].data.projectionSenders ?? [];
const statusKey = (index = 0) => projectionBindingStatusKey("source", projectionBindingKey(bindings()[index].link));
const popupRects = () => extraRects().filter((rect) => rect.id.startsWith("projection-target-popover-"));
const idle = async () => { await vi.waitFor(() => expect(button("刷新可接收设备").disabled).toBe(false)); };
const start = async (id = "pc2") => { box(id).click(); await idle(); };
beforeEach(async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.mocked(projectionContext).mockResolvedValue(origin);
    vi.mocked(deliveryTargets).mockResolvedValue(directory);
    vi.mocked(loadPreparedCreate).mockResolvedValue(undefined);
    vi.mocked(renderProjectionFrame).mockResolvedValue({ digest: "a".repeat(64), snapshot: { imageBase64: btoa("a"), width: 1, height: 1 } });
    vi.mocked(createProjectionWithRecovery).mockImplementation(async (_origin, _source, target) => {
        const response = projectionResponse();
        response.envelope.projectionId = "projection:" + (target.deviceId === "pc2" ? "1" : "2").repeat(32);
        return response;
    });
    const unit = projectionUnit(); unit.data.qrProjection = undefined;
    graphStore.actions.replaceUnits([unit]);
    dispose = render(() => <ProjectionPropertyBar unitId="source" mode="send" />, document.body);
    button("选择投射设备").click(); await idle();
});
afterEach(() => {
    sync?.dispose(); sync = undefined; dispose?.(); graphStore.actions.replaceUnits([]); document.body.replaceChildren();
    for (const key of Object.keys(projectionStatuses)) setProjectionStatuses(key, undefined);
    vi.resetAllMocks(); vi.unstubAllGlobals();
});

it("removes send/result buttons and keeps three count-free target dropdowns", () => {
    expect(document.querySelector('button[aria-label^="投射到"]')).toBeNull();
    expect(button("投射结果与关联")).toBeNull();
    for (const label of ["选择投射设备", "选择投射设备组", "选择投射用户"]) {
        expect(button(label).textContent).toBe("");
        expect(button(label).querySelectorAll("svg")).toHaveLength(2);
    }
    button("选择投射用户").click();
    expect(document.body.textContent).toContain("用户投射尚未开放");
    expect(document.querySelectorAll("input")).toHaveLength(0);
});

it("starts on check but shows success only after displayed acknowledgement", async () => {
    const input = box(); await start();
    expect(createProjectionWithRecovery).toHaveBeenCalledTimes(1);
    expect(bindings()).toHaveLength(1); expect(box().checked).toBe(true);
    expect(marker().dataset.phase).toBe("pending");
    setProjectionStatuses(statusKey(), { phase: "connected", delivery: { targetDeviceId: "pc2", status: "accepted" } });
    expect(marker().dataset.phase).toBe("pending");
    setProjectionStatuses(statusKey(), { phase: "connected", delivery: { targetDeviceId: "pc2", status: "displayed" } });
    expect(marker().dataset.phase).toBe("success");
    expect(box()).toBe(input);
});

it("persists stop intent and waits for the real sync unlink result before showing cancel success", async () => {
    await start();
    const key = statusKey();
    let resolve!: () => void;
    const unlink = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    box().click(); await idle();
    expect(bindings()[0].link.stopPending).toBe(true);
    expect(box().checked).toBe(false); expect(marker().dataset.phase).toBe("pending");
    sync = createProjectionSync({
        units: () => graphStore.units, generation: () => 0, onUnitRemoved: () => () => undefined,
        signature: () => "image", render: vi.mocked(renderProjectionFrame), request: vi.fn(),
        unlink, patch: patchProjection, status: (id, value) => setProjectionStatuses(id, value),
    });
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(marker().dataset.phase).toBe("pending");
    resolve();
    await vi.waitFor(() => expect(bindings()).toHaveLength(0));
    expect(marker().dataset.phase).toBe("success");
    expect(marker().title).toContain("取消投射成功");
    sync.tick();
    expect(projectionStatuses[key]).toBeUndefined();
    expect(marker().dataset.phase).toBe("success");
});

it("shows a cancel failure while durable background retries keep the checkbox off", async () => {
    await start(); const key = statusKey(); box().click(); await idle();
    setProjectionStatuses(key, { phase: "stopping", error: "projection_network_error" });
    expect(box().checked).toBe(false); expect(box().disabled).toBe(true);
    expect(marker().dataset.phase).toBe("error"); expect(marker().title).toContain("后台重试");
    patchProjection("source", undefined, undefined, projectionBindingKey(bindings()[0].link));
    setProjectionStatuses(key, { phase: "stopped" });
    expect(marker().dataset.phase).toBe("success");
});

it("retries failed creates inline and does not silently claim success", async () => {
    vi.mocked(createProjectionWithRecovery).mockRejectedValueOnce(new Error("projection_target_offline"));
    await start(); expect(bindings()).toHaveLength(0);
    expect(box().checked).toBe(true); expect(marker().dataset.phase).toBe("error");
    button("重试 pc2").click(); await idle();
    expect(createProjectionWithRecovery).toHaveBeenCalledTimes(2);
    expect(bindings()).toHaveLength(1); expect(marker().dataset.phase).toBe("pending");
});

it("cancels an uncertain failed create durably and only then unlinks that target", async () => {
    vi.mocked(createProjectionWithRecovery).mockRejectedValueOnce(new Error("projection_network_error"));
    await start();
    const envelope = projectionResponse().envelope;
    vi.mocked(loadPreparedCreate).mockResolvedValue({ key: "prepared", origin, unitId: "source", targetDeviceId: "pc2",
        envelope, snapshot: { imageBase64: btoa("a"), width: 1, height: 1 } });
    let resolve!: () => void;
    vi.mocked(unlinkProjection).mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    box().click();
    await vi.waitFor(() => expect(unlinkProjection).toHaveBeenCalled());
    expect(cancelPreparedCreate).toHaveBeenCalledWith(JSON.stringify([origin, "source", "", "pc2"]));
    expect(marker().dataset.phase).toBe("pending");
    resolve(); await idle(); expect(marker().dataset.phase).toBe("success");
    expect(createProjectionWithRecovery).toHaveBeenCalledTimes(1);
});

it("deduplicates device/group starts and group stop does not touch unrelated bindings", async () => {
    await start();
    const unrelated = { ...bindings()[0], target: { deviceId: "pc4", name: "PC4" },
        link: { ...bindings()[0].link, envelope: { ...bindings()[0].link.envelope, projectionId: "projection:" + "4".repeat(32) } } };
    saveProjectionSenders("source", [...bindings(), unrelated]);
    button("选择投射设备组").click();
    expect(box("team").indeterminate).toBe(true);
    await start("team"); expect(createProjectionWithRecovery).toHaveBeenCalledTimes(2);
    expect(box("team").checked).toBe(true);
    box("team").click(); await idle();
    expect(bindings().filter((binding) => binding.link.stopPending)).toHaveLength(2);
    expect(bindings().find((binding) => binding.target.deviceId === "pc4")!.link.stopPending).toBeUndefined();
});

it("marks partial group failure and retries only the missing target", async () => {
    vi.mocked(createProjectionWithRecovery).mockRejectedValueOnce(new Error("projection_target_offline"));
    button("选择投射设备组").click(); await start("team");
    expect(bindings()).toHaveLength(1); expect(marker("team").dataset.phase).toBe("error");
    button("重试 team").click(); await idle();
    expect(createProjectionWithRecovery).toHaveBeenCalledTimes(3); expect(bindings()).toHaveLength(2);
    expect(marker("team").dataset.phase).toBe("pending");
});

it("retains saved targets for cancellation when directory lookup fails", async () => {
    await start();
    vi.mocked(deliveryTargets).mockRejectedValue(new Error("projection_network_error"));
    button("刷新可接收设备").click(); await idle();
    expect(box().checked).toBe(true);
    const before = vi.mocked(deliveryTargets).mock.calls.length;
    box().click(); await idle();
    expect(bindings()[0].link.stopPending).toBe(true);
    expect(deliveryTargets).toHaveBeenCalledTimes(before);
});

it("refuses a changed Loom instead of sending the old checkbox to a new origin", async () => {
    vi.mocked(projectionContext).mockResolvedValue("https://other.example.test");
    await start();
    expect(createProjectionWithRecovery).not.toHaveBeenCalled();
    expect(marker().dataset.phase).toBe("error"); expect(marker().title).toContain("当前 Loom 已变化");
});

it("keeps creation alive when the dropdown closes, but not after replacing the source", async () => {
    let finish!: (response: ReturnType<typeof projectionResponse>) => void;
    vi.mocked(createProjectionWithRecovery).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    box().click(); await vi.waitFor(() => expect(finish).toBeDefined());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    finish(projectionResponse()); await vi.waitFor(() => expect(bindings()).toHaveLength(1));
    button("选择投射设备").click(); await idle(); expect(box().checked).toBe(true);
    box("pc3").click(); await vi.waitFor(() => expect(createProjectionWithRecovery).toHaveBeenCalledTimes(2));
    graphStore.actions.removeUnit("source");
    const replacement = projectionUnit(); replacement.data.qrProjection = undefined; graphStore.actions.addUnit(replacement);
    finish(projectionResponse());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bindings()).toHaveLength(0);
});

it("cleans native hit rectangles and restores focus on Escape", () => {
    expect(popupRects()).toHaveLength(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popupRects()).toHaveLength(0); expect(document.activeElement).toBe(button("选择投射设备"));
    button("选择投射设备").click(); document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(popupRects()).toHaveLength(0);
    button("选择投射设备").click(); dispose(); expect(popupRects()).toHaveLength(0);
});

it("restores a persisted stop and retains its remote identity after a terminal failure", async () => {
    await start(); const binding = bindings()[0]; const key = statusKey();
    box().click(); await idle(); dispose();
    dispose = render(() => <ProjectionPropertyBar unitId="source" mode="send" />, document.body);
    button("选择投射设备").click(); await idle();
    expect(box().checked).toBe(false); expect(marker().dataset.phase).toBe("pending");
    patchProjection("source", undefined, undefined, projectionBindingKey(binding.link));
    setProjectionStatuses(key, { phase: "stopped", error: "projection_access_denied" });
    expect(marker().dataset.phase).toBe("error");
    vi.mocked(unlinkProjection).mockRejectedValue(new Error("projection_access_denied"));
    button("重试 pc2").click(); await idle();
    expect(unlinkProjection).toHaveBeenCalledWith(binding.link.envelope.projectionId, origin, "neuro.qr-projection.v1");
    expect(marker().dataset.phase).toBe("error");
});

it("retries a failed group cancellation without starting a new projection or repeating confirmed members", async () => {
    button("选择投射设备组").click(); await start("team");
    const originals = [...bindings()];
    box("team").click(); await idle();
    for (const binding of originals) {
        patchProjection("source", undefined, undefined, projectionBindingKey(binding.link));
        setProjectionStatuses(projectionBindingStatusKey("source", projectionBindingKey(binding.link)),
            { phase: "stopped", ...(binding.target.deviceId === "pc2" ? { error: "projection_access_denied" } : {}) });
    }
    expect(marker("team").dataset.phase).toBe("error");
    vi.mocked(unlinkProjection).mockRejectedValueOnce(new Error("projection_access_denied"));
    button("重试 team").click(); await idle();
    expect(createProjectionWithRecovery).toHaveBeenCalledTimes(2);
    expect(loadPreparedCreate).not.toHaveBeenCalled();
    expect(unlinkProjection).toHaveBeenCalledWith(originals[0].link.envelope.projectionId, origin, "neuro.qr-projection.v1");
    expect(marker("team").dataset.phase).toBe("error");
    vi.mocked(unlinkProjection).mockResolvedValue(undefined);
    button("重试 team").click(); await idle();
    expect(unlinkProjection).toHaveBeenCalledTimes(2);
    expect(createProjectionWithRecovery).toHaveBeenCalledTimes(2);
    expect(marker("team").dataset.phase).toBe("success");
});

it("keeps same device IDs on another Loom distinct when cancelling a saved target", async () => {
    await start();
    const existing = bindings()[0];
    const other = { ...existing, link: { ...existing.link, envelope: { ...existing.link.envelope,
        serverOrigin: "https://other.example.test", projectionId: "projection:" + "3".repeat(32) } } };
    saveProjectionSenders("source", [existing, other]);
    const matches = document.querySelectorAll<HTMLInputElement>('input[aria-label="pc2 投射开关"]');
    expect(matches).toHaveLength(2);
    matches[1].click(); await idle();
    expect(bindings()[0].link.stopPending).toBeUndefined();
    expect(bindings()[1].link.stopPending).toBe(true);
});

it("replaces status snapshots so a recovered send clears its old error and receipts do not leak into stopping", async () => {
    await start(); const key = statusKey();
    setProjectionStatuses(key, { phase: "retrying", error: "projection_network_error" });
    expect(marker().dataset.phase).toBe("error");
    setProjectionStatuses(key, { phase: "connected", delivery: { targetDeviceId: "pc2", status: "displayed" } });
    expect(marker().dataset.phase).toBe("success"); expect(projectionStatuses[key]?.error).toBeUndefined();
    setProjectionStatuses(key, { phase: "stopping" });
    expect(projectionStatuses[key]?.delivery).toBeUndefined();
});

it("reads the latest target state when a saved retry callback runs after its binding is removed", async () => {
    await start();
    const binding = bindings()[0];
    setProjectionStatuses(statusKey(), { phase: "retrying", error: "projection_network_error" });
    dispose();
    const controls = createRoot((rootDispose) => {
        dispose = rootDispose;
        return useProjectionTargetControls({ unitId: "source" });
    });
    await vi.waitFor(() => expect(controls.busy()).toBe(false));
    const row = controls.rows("devices").find((item) => item.id === "pc2")!;
    expect(row.checked).toBe(true);
    expect(row.retry).toBeTypeOf("function");
    patchProjection("source", undefined, undefined, projectionBindingKey(binding.link));
    row.retry!();
    await vi.waitFor(() => expect(controls.busy()).toBe(false));
    expect(createProjectionWithRecovery).toHaveBeenCalledTimes(1);
    expect(bindings()).toHaveLength(0);
    expect(controls.rows("devices").find((item) => item.id === "pc2")?.checked).toBe(false);
});
