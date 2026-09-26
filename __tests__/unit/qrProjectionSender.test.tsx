import { afterEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { QrProjectionSender } from "../../src/components/QrProjectionSender";
import { projectionAccountContext, requestProjection } from "../../src/services/qrProjectionApi";
import { graphStore } from "../../src/store/graphStore";
import { projectionResponse, projectionUnit } from "../fixtures/qrProjection";
import type { Unit } from "../../src/types/unit";
import { invalidateProjectionUnit } from "../../src/services/qrProjectionLifecycle";
import { renderProjectionFrame } from "../../src/services/qrProjectionSnapshot";
import { queueProjectionUnlink } from "../../src/services/qrProjectionCleanup";
import { patchProjection } from "../../src/services/qrProjectionSession";

vi.mock("../../src/store/graphStore", () => ({ graphStore: { units: [] as Unit[] } }));
vi.mock("../../src/services/qrProjectionApi", () => ({ projectionAccountContext: vi.fn(), requestProjection: vi.fn(), projectionCode: vi.fn() }));
vi.mock("../../src/services/qrProjectionSession", () => ({ patchProjection: vi.fn(), projectionLinkFromResponse: vi.fn() }));
vi.mock("../../src/services/qrProjectionCleanup", () => ({ queueProjectionUnlink: vi.fn() }));
vi.mock("../../src/services/qrProjectionSnapshot", () => ({ renderProjectionFrame: vi.fn() }));

let dispose: (() => void) | undefined;
let container: HTMLDivElement;
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
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(button("生成投射二维码").disabled).toBe(true);
    button("生成投射二维码").click();
    expect(requestProjection).not.toHaveBeenCalled();
    vi.mocked(projectionAccountContext).mockResolvedValueOnce({ origin: "https://account.example.test", accountId: "account:test", deviceId: "device:a", deviceName: "Local Loom" });
    button("刷新 Loom 登录状态").click();
    await vi.waitFor(() => expect(button("生成投射二维码").disabled).toBe(false));
    expect(container.textContent).toContain("Local Loom");
    expect(container.textContent).toContain("https://account.example.test");
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
