import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { createStore } from "solid-js/store";
import { QrProjectionSender } from "../../src/components/QrProjectionSender";
import { projectionAccountContext, projectionContext, requestProjection, projectionCode } from "../../src/services/qrProjectionApi";
import { api } from "../../src/services/api";
import { parseProjectionInvitation } from "../../src/services/qrProjectionProtocol";
import { graphStore } from "../../src/store/graphStore";
import { projectionEnvelopeV2, projectionResponse, projectionUnit } from "../fixtures/qrProjection";
import type { Unit } from "../../src/types/unit";
import { invalidateProjectionUnit } from "../../src/services/qrProjectionLifecycle";
import { renderProjectionFrame } from "../../src/services/qrProjectionSnapshot";
import { queueProjectionUnlink } from "../../src/services/qrProjectionCleanup";
import { patchProjection } from "../../src/services/qrProjectionSession";
import { projectionDialog } from "../../src/store/qrProjectionStore";

vi.mock("../../src/store/graphStore", () => ({ graphStore: { units: [] as Unit[] } }));
vi.mock("../../src/services/qrProjectionApi", () => ({ projectionContext: vi.fn(), projectionAccountContext: vi.fn(), requestProjection: vi.fn(), projectionCode: vi.fn() }));
vi.mock("../../src/services/qrProjectionSession", () => ({ patchProjection: vi.fn(), projectionLinkFromResponse: vi.fn() }));
vi.mock("../../src/services/qrProjectionCleanup", () => ({ queueProjectionUnlinks: vi.fn(), queueProjectionUnlink: vi.fn() }));
vi.mock("../../src/services/qrProjectionSnapshot", () => ({ renderProjectionFrame: vi.fn() }));
vi.mock("../../src/services/projectionEditJournal", () => ({
    loadProjectionEdit: async () => undefined, saveProjectionEdit: vi.fn(), forgetProjectionEdit: async () => undefined,
}));

let dispose: (() => void) | undefined;
let container: HTMLDivElement;
it("opens the dedicated multi-target selection from the general projection panel", async () => {
    const unit = projectionUnit(); unit.data.qrProjection = undefined;
    graphStore.units.splice(0, graphStore.units.length, unit);
    vi.mocked(renderProjectionFrame).mockResolvedValue({ snapshot: { imageBase64: btoa("a"), width: 1, height: 1 }, digest: "a".repeat(64) });
    vi.mocked(requestProjection).mockResolvedValue(projectionResponse());
    container = document.createElement("div"); document.body.append(container);
    dispose = render(() => <QrProjectionSender unitId={unit.id} retry={vi.fn()} />, container);
    const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text))!;
    button("选择设备与设备组").click();
    expect(projectionDialog()).toEqual({ unitId: unit.id, shareAction: "targets" });
    expect(requestProjection).not.toHaveBeenCalled();
});
beforeEach(() => { vi.mocked(projectionContext).mockResolvedValue("https://loom.example.test"); });
afterEach(() => { dispose?.(); container.remove(); vi.resetAllMocks(); });

it.each(["qr", "link"] as const)("generates a %s invitation directly from the secondary button using configured Loom", async (shareAction) => {
    const unit = projectionUnit(); unit.data.qrProjection = undefined;
    graphStore.units.splice(0, graphStore.units.length, unit);
    vi.mocked(renderProjectionFrame).mockResolvedValue({ snapshot: { imageBase64: btoa("a"), width: 1, height: 1 }, digest: "a".repeat(64) });
    vi.mocked(requestProjection).mockResolvedValue(projectionResponse());
    container = document.createElement("div"); document.body.append(container);
    dispose = render(() => <QrProjectionSender unitId={unit.id} retry={vi.fn()} shareAction={shareAction} />, container);
    await vi.waitFor(() => expect(requestProjection).toHaveBeenCalledTimes(1));
    expect(container.querySelector("input")).toBeNull();
    expect(projectionAccountContext).not.toHaveBeenCalled();
});

it("displays and copies the same versioned link without generating a QR or a second invitation", async () => {
    const source = projectionUnit(); source.data.qrProjection!.linked = false;
    source.data.qrProjection!.envelope.expiresAtMs = Date.now() + 60_000;
    graphStore.units.splice(0, graphStore.units.length, source);
    const copy = vi.spyOn(api, "copyTextToClipboard").mockResolvedValue(true);
    container = document.createElement("div"); document.body.append(container);
    dispose = render(() => <QrProjectionSender unitId={source.id} retry={vi.fn()} shareAction="link" />, container);
    const text = container.querySelector("textarea")!.value;
    expect(parseProjectionInvitation(text)).toEqual(source.data.qrProjection!.envelope);
    button("复制链接").click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(text));
    expect(requestProjection).not.toHaveBeenCalled(); expect(projectionCode).not.toHaveBeenCalled();
    copy.mockRestore();
});

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
it("shows only the QR and selectable invitation link in compact sharing mode", async () => {
    const source = projectionUnit(); source.data.qrProjection!.linked = false;
    source.data.qrProjection!.envelope.expiresAtMs = Date.now() + 60_000;
    graphStore.units.splice(0, graphStore.units.length, source);
    vi.mocked(projectionCode).mockResolvedValue("data:image/svg+xml;base64,PHN2Zy8+");
    const copy = vi.spyOn(api, "copyTextToClipboard").mockResolvedValue(true);
    container = document.createElement("div"); document.body.append(container);
    dispose = render(() => <QrProjectionSender unitId={source.id} retry={vi.fn()} shareAction="qr" />, container);
    await vi.waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toContain("data:image/svg+xml"));
    expect(container.querySelectorAll("button, p")).toHaveLength(0);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="投射链接"]')!;
    expect(parseProjectionInvitation(input.value)).toEqual(source.data.qrProjection!.envelope);
    input.click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(input.value));
    expect(input.selectionEnd).toBe(input.value.length);
    expect(requestProjection).not.toHaveBeenCalled();
});
