import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { QrProjectionReceiver } from "../../src/components/QrProjectionReceiver";
import { requestProjection } from "../../src/services/qrProjectionApi";
import { attachProjectionReceiver } from "../../src/services/qrProjectionSession";
import { queueProjectionUnlink } from "../../src/services/qrProjectionCleanup";
import { importProjectionQr } from "../../src/services/projectionQrImport";
import { projectionInvitationLink } from "../../src/services/projectionInvitationLink";
import { projectionEnvelope, projectionResponse } from "../fixtures/qrProjection";

vi.mock("../../src/services/qrProjectionApi", () => ({ requestProjection: vi.fn(), unlinkProjection: vi.fn() }));
vi.mock("../../src/services/qrProjectionSession", () => ({ attachProjectionReceiver: vi.fn() }));
vi.mock("../../src/services/qrProjectionCleanup", () => ({ queueProjectionUnlinks: vi.fn(), queueProjectionUnlink: vi.fn() }));
vi.mock("../../src/services/projectionQrImport", () => ({ importProjectionQr: vi.fn() }));

let host: HTMLDivElement;
let dispose: () => void;
const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;
const enterLink = (value = projectionInvitationLink(projectionEnvelope())) => {
    button("投射链接").click();
    const input = host.querySelector("textarea")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
};
const chooseImage = () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["png"], "invitation.png", { type: "image/png" })] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
};
beforeEach(() => {
    host = document.createElement("div"); document.body.append(host);
    dispose = render(() => <QrProjectionReceiver initialText="" importKind="combined" />, host);
});
afterEach(() => { dispose(); host.remove(); vi.resetAllMocks(); });

it("imports a link only on confirmation and accepts the freshly inspected revision", async () => {
    expect(button("二维码图片")).toBeDefined();
    expect(button("导入").disabled).toBe(true);
    enterLink();
    expect(host.textContent).toContain("https://loom.example.test");
    expect(requestProjection).not.toHaveBeenCalled();
    vi.mocked(requestProjection).mockResolvedValueOnce(projectionResponse(7, "b")).mockResolvedValueOnce(projectionResponse(7, "b"));
    button("导入").click(); button("正在导入…").click();
    await vi.waitFor(() => expect(attachProjectionReceiver).toHaveBeenCalledTimes(1));
    expect(vi.mocked(requestProjection).mock.calls.map(([op]) => op.kind)).toEqual(["inspect", "accept"]);
    expect(requestProjection).toHaveBeenLastCalledWith(expect.objectContaining({
        kind: "accept", expectedRevision: 7, expectedDigest: "b".repeat(64), confirmed: true,
    }));
});

it("invalid links never contact the receiver and can be corrected", () => {
    enterLink("https://unrelated.example/");
    expect(button("导入").disabled).toBe(true);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(requestProjection).not.toHaveBeenCalled();
    enterLink();
    expect(button("导入").disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("decodes QR locally and clears a previous invitation while a replacement image is decoding", async () => {
    vi.mocked(importProjectionQr).mockResolvedValueOnce(JSON.stringify(projectionEnvelope()));
    chooseImage();
    await vi.waitFor(() => expect(button("导入").disabled).toBe(false));
    expect(requestProjection).not.toHaveBeenCalled();
    let resolve!: (text: string) => void;
    vi.mocked(importProjectionQr).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    chooseImage();
    expect(button("导入").disabled).toBe(true);
    resolve(JSON.stringify(projectionEnvelope()));
    await vi.waitFor(() => expect(button("导入").disabled).toBe(false));
    vi.mocked(requestProjection).mockResolvedValue(projectionResponse());
    button("导入").click();
    await vi.waitFor(() => expect(attachProjectionReceiver).toHaveBeenCalledTimes(1));
});

it("switching to link input aborts pending QR decoding and ignores its late result", async () => {
    let resolve!: (text: string) => void;
    vi.mocked(importProjectionQr).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    chooseImage();
    const signal = vi.mocked(importProjectionQr).mock.calls[0][1]!;
    button("投射链接").click();
    expect(signal.aborted).toBe(true);
    resolve(JSON.stringify(projectionEnvelope()));
    await Promise.resolve();
    expect(button("导入").disabled).toBe(true);
    expect(host.querySelector("textarea")!.value).toBe("");
});

it("keeps failures visible, does not accept a failed inspection, and retries a lost acceptance with the same ID", async () => {
    enterLink();
    vi.mocked(requestProjection).mockRejectedValueOnce(new Error("projection_network_error"));
    button("导入").click();
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
    expect(attachProjectionReceiver).not.toHaveBeenCalled();
    expect(requestProjection).toHaveBeenCalledTimes(1);
    vi.mocked(requestProjection).mockResolvedValueOnce(projectionResponse()).mockRejectedValueOnce(new Error("projection_network_error"));
    button("导入").click();
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
    vi.mocked(requestProjection).mockResolvedValue(projectionResponse());
    button("导入").click();
    await vi.waitFor(() => expect(attachProjectionReceiver).toHaveBeenCalledTimes(1));
    const accepts = vi.mocked(requestProjection).mock.calls.map(([op]) => op).filter((op) => op.kind === "accept");
    expect(accepts).toHaveLength(2);
    expect(accepts[1].receiverUnitId).toBe(accepts[0].receiverUnitId);
});

it("closing during inspection prevents acceptance and creating a late sticker", async () => {
    enterLink();
    let resolve!: (response: ReturnType<typeof projectionResponse>) => void;
    vi.mocked(requestProjection).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    button("导入").click(); dispose();
    resolve(projectionResponse());
    await Promise.resolve(); await Promise.resolve();
    expect(requestProjection).toHaveBeenCalledTimes(1);
    expect(attachProjectionReceiver).not.toHaveBeenCalled();
    expect(queueProjectionUnlink).not.toHaveBeenCalled();
});
