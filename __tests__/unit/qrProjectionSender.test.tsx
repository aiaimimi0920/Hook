import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { createStore } from "solid-js/store";
import { QrProjectionSender } from "../../src/components/QrProjectionSender";
import { projectionAccountContext, projectionContext, requestProjection } from "../../src/services/qrProjectionApi";
import { graphStore } from "../../src/store/graphStore";
import { projectionEnvelopeV2, projectionResponse, projectionUnit } from "../fixtures/qrProjection";
import type { Unit } from "../../src/types/unit";
import { invalidateProjectionUnit } from "../../src/services/qrProjectionLifecycle";
import { renderProjectionFrame } from "../../src/services/qrProjectionSnapshot";
import { queueProjectionUnlink } from "../../src/services/qrProjectionCleanup";
import { patchProjection } from "../../src/services/qrProjectionSession";
import { deliveryTargets } from "../../src/services/projectionDeliveryApi";

vi.mock("../../src/store/graphStore", () => ({ graphStore: { units: [] as Unit[] } }));
vi.mock("../../src/services/qrProjectionApi", () => ({ projectionContext: vi.fn(), projectionAccountContext: vi.fn(), requestProjection: vi.fn(), projectionCode: vi.fn() }));
vi.mock("../../src/services/qrProjectionSession", () => ({ patchProjection: vi.fn(), projectionLinkFromResponse: vi.fn() }));
vi.mock("../../src/services/qrProjectionCleanup", () => ({ queueProjectionUnlink: vi.fn() }));
vi.mock("../../src/services/qrProjectionSnapshot", () => ({ renderProjectionFrame: vi.fn() }));
vi.mock("../../src/services/projectionDeliveryApi", () => ({ deliveryTargets: vi.fn() }));

let dispose: (() => void) | undefined;
let container: HTMLDivElement;
it("selects an advertised shared Loom device and creates an atomic targeted invitation", async () => {
    const unit = projectionUnit(); unit.data.qrProjection = undefined;
    graphStore.units.splice(0, graphStore.units.length, unit);
    vi.mocked(deliveryTargets).mockResolvedValue({ status: "complete", targets: [{ deviceId: "device:pc3", name: "PC 3", policy: "confirm", route: "shared_loom" }] });
    vi.mocked(renderProjectionFrame).mockResolvedValue({ snapshot: { imageBase64: btoa("a"), width: 1, height: 1 }, digest: "a".repeat(64) });
    vi.mocked(requestProjection).mockResolvedValue(projectionResponse());
    container = document.createElement("div"); document.body.append(container);
    dispose = render(() => <QrProjectionSender unitId={unit.id} retry={vi.fn()} />, container);
    const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text))!;
    await vi.waitFor(() => expect(button("刷新可接收设备").disabled).toBe(false));
    button("刷新可接收设备").click();
    await vi.waitFor(() => expect(button("投送到 PC 3")).toBeDefined());
    button("投送到 PC 3").click();
    await vi.waitFor(() => expect(requestProjection).toHaveBeenCalledWith(expect.objectContaining({ targetDeviceId: "device:pc3" }),
        "https://loom.example.test", "neuro.qr-projection.v1"));
});
beforeEach(() => { vi.mocked(projectionContext).mockResolvedValue("https://loom.example.test"); });
afterEach(() => { dispose?.(); container.remove(); vi.resetAllMocks(); });

it("requires the local Loom account before creating a new invitation and refreshes after login", async () => {
    const unit = projectionUnit();
    unit.data.qrProjection = undefined;
    graphStore.units.splice(0, graphStore.units.length, unit);
    vi.mocked(projectionAccountContext).mockRejectedValueOnce(new Error("account_login_required"));
    container = document.createElement("div");
    document.body.append(container);
    dispose = render(() => <QrProjectionSender unitId={unit.id} retry={vi.fn()} />, container);
    const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text))!;
    button("Loom 账号联网").click();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(button("生成投射二维码").disabled).toBe(true);
    button("生成投射二维码").click();
    expect(requestProjection).not.toHaveBeenCalled();
    vi.mocked(projectionAccountContext).mockResolvedValueOnce({ origin: "https://account.example.test", accountId: "account:test", deviceId: "device:a", deviceName: "Local Loom" });
    button("刷新 Loom 登录状态").click();
    await vi.waitFor(() => expect(button("生成投射二维码").disabled).toBe(false));
    expect(container.textContent).toContain("Local Loom");
    expect(container.textContent).toContain("https://account.example.test");
    vi.mocked(renderProjectionFrame).mockResolvedValue({ snapshot: { imageBase64: btoa("a"), width: 1, height: 1 }, digest: "a".repeat(64) });
    vi.mocked(requestProjection).mockResolvedValue({ ...projectionResponse(), envelope: projectionEnvelopeV2() });
    button("生成投射二维码").click();
    await vi.waitFor(() => expect(requestProjection).toHaveBeenCalledWith(expect.objectContaining({ kind: "create" }), "https://account.example.test", "neuro.qr-projection.v2"));
});

it.each([false, true])("isolates pending creation from unit deletion (same ID=%s)", async (sameId) => {
    const source = projectionUnit(); source.data.qrProjection = undefined;
    graphStore.units.splice(0, graphStore.units.length, source);
    vi.mocked(projectionAccountContext).mockResolvedValue({ origin: "https://account.example.test", accountId: "account:test", deviceId: "device:a", deviceName: "Local Loom" });
    vi.mocked(renderProjectionFrame).mockResolvedValue({ snapshot: { imageBase64: btoa("a"), width: 1, height: 1 }, digest: "a".repeat(64) });
    let finish!: (value: ReturnType<typeof projectionResponse>) => void;
    vi.mocked(requestProjection).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    container = document.createElement("div"); document.body.append(container);
    dispose = render(() => <QrProjectionSender unitId={source.id} retry={vi.fn()} />, container);
    const generate = () => [...container.querySelectorAll("button")].find((item) => item.textContent?.includes("生成投射二维码"))!;
    await vi.waitFor(() => expect(generate().disabled).toBe(false));
    generate().click();
    await vi.waitFor(() => expect(requestProjection).toHaveBeenCalledTimes(1));
    invalidateProjectionUnit(sameId ? source.id : "unrelated");
    if (sameId) graphStore.units.splice(0, 1, { ...source, data: { ...source.data } });
    finish(projectionResponse());
    await vi.waitFor(() => expect(generate().disabled).toBe(false));
    if (sameId) {
        expect(patchProjection).not.toHaveBeenCalled();
        expect(queueProjectionUnlink).toHaveBeenCalledWith(projectionResponse().envelope);
    } else {
        expect(patchProjection).toHaveBeenCalledTimes(1);
        expect(queueProjectionUnlink).not.toHaveBeenCalled();
    }
});

const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text))!;

it("does not reinterpret a saved account service as a shared Loom after unlink", async () => {
    const source = projectionUnit();
    source.data.qrProjection!.envelope = projectionEnvelopeV2();
    const [reactiveSource, setSource] = createStore(source);
    graphStore.units.splice(0, graphStore.units.length, reactiveSource);
    vi.mocked(projectionAccountContext).mockResolvedValue({ origin: "https://account.example.test", accountId: "a", deviceId: "d", deviceName: "Saved Loom" });
    container = document.createElement("div"); document.body.append(container);
    dispose = render(() => <QrProjectionSender unitId={source.id} retry={vi.fn()} />, container);
    await vi.waitFor(() => expect(container.textContent).toContain("Saved Loom"));
    setSource("data", "qrProjection", undefined);
    expect(button("Loom 账号联网").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("input")).toBeNull();
    expect(projectionContext).not.toHaveBeenCalled();
});
const mountSource = () => {
    const source = projectionUnit(); source.data.qrProjection = undefined;
    graphStore.units.splice(0, graphStore.units.length, source);
    container = document.createElement("div"); document.body.append(container);
    dispose = render(() => <QrProjectionSender unitId={source.id} retry={vi.fn()} />, container);
};
const editOrigin = (value: string) => {
    const input = container.querySelector("input")!;
    input.value = value; input.dispatchEvent(new Event("input", { bubbles: true }));
};

it("creates a shared Loom invitation without requesting an official account", async () => {
    vi.mocked(renderProjectionFrame).mockResolvedValue({ snapshot: { imageBase64: btoa("a"), width: 1, height: 1 }, digest: "a".repeat(64) });
    vi.mocked(requestProjection).mockResolvedValue(projectionResponse());
    mountSource();
    await vi.waitFor(() => expect(button("生成投射二维码").disabled).toBe(false));
    button("生成投射二维码").click();
    await vi.waitFor(() => expect(patchProjection).toHaveBeenCalledTimes(1));
    expect(requestProjection).toHaveBeenCalledWith(expect.objectContaining({ kind: "create", unitId: "source" }), "https://loom.example.test", "neuro.qr-projection.v1");
    expect(projectionAccountContext).not.toHaveBeenCalled();
});

it.each(["http://192.168.15.132:19820", "https://user:secret@loom.example.test", "https://loom.example.test/path"])("rejects unsafe shared origin %s before rendering or sending", async (origin) => {
    mountSource();
    await vi.waitFor(() => expect(button("生成投射二维码").disabled).toBe(false));
    editOrigin(origin); button("生成投射二维码").click();
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(renderProjectionFrame).not.toHaveBeenCalled();
    expect(requestProjection).not.toHaveBeenCalled();
});

it("does not overwrite an explicit shared address with a late manifest lookup", async () => {
    let resolve!: (origin: string) => void;
    vi.mocked(projectionContext).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    mountSource(); editOrigin("https://chosen.example.test");
    resolve("http://127.0.0.1:19820"); await Promise.resolve();
    expect(container.querySelector("input")!.value).toBe("https://chosen.example.test");
    expect(button("生成投射二维码").disabled).toBe(false);
});

it("ignores a late account result after switching back to shared Loom", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof projectionAccountContext>>) => void;
    vi.mocked(projectionAccountContext).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    mountSource(); button("Loom 账号联网").click(); button("共享 Loom").click();
    await vi.waitFor(() => expect(container.querySelector("input")!.value).toBe("https://loom.example.test"));
    resolve({ origin: "https://account.example.test", accountId: "a", deviceId: "d", deviceName: "Late account" });
    await Promise.resolve();
    expect(container.textContent).not.toContain("Late account");
    expect(container.querySelector("input")!.value).toBe("https://loom.example.test");
    expect(button("生成投射二维码").disabled).toBe(false);
});

it("keeps saved shared associations pinned without re-reading account or configuration", () => {
    const source = projectionUnit(); graphStore.units.splice(0, graphStore.units.length, source);
    container = document.createElement("div"); document.body.append(container);
    dispose = render(() => <QrProjectionSender unitId={source.id} retry={vi.fn()} />, container);
    expect(container.querySelector('[aria-label="投射连接方式"]')).toBeNull();
    expect(container.textContent).toContain(source.data.qrProjection!.envelope.serverOrigin);
    expect(projectionContext).not.toHaveBeenCalled();
    expect(projectionAccountContext).not.toHaveBeenCalled();
});
