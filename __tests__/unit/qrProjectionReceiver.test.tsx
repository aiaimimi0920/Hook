import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { QrProjectionReceiver } from "../../src/components/QrProjectionReceiver";
import { requestProjection } from "../../src/services/qrProjectionApi";
import { queueProjectionUnlink } from "../../src/services/qrProjectionCleanup";
import { attachProjectionReceiver } from "../../src/services/qrProjectionSession";
import { projectionEnvelope, projectionResponse, projectionUnit } from "../fixtures/qrProjection";
import { graphStore } from "../../src/store/graphStore";

vi.mock("../../src/services/qrProjectionApi", () => ({ requestProjection: vi.fn(), unlinkProjection: vi.fn() }));
vi.mock("../../src/services/qrProjectionSession", () => ({ attachProjectionReceiver: vi.fn() }));
vi.mock("../../src/services/qrProjectionCleanup", () => ({ queueProjectionUnlinks: vi.fn(), queueProjectionUnlink: vi.fn() }));

describe("projection receiver confirmation", () => {
    let container: HTMLDivElement;
    let dispose: () => void;
    beforeEach(() => {
        container = document.createElement("div"); document.body.append(container);
        dispose = render(() => <QrProjectionReceiver initialText={JSON.stringify(projectionEnvelope())} />, container);
    });
    afterEach(() => { dispose(); container.remove(); graphStore.actions.replaceUnits([]); vi.resetAllMocks(); });
    const click = (text: string) => {
        const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
        expect(button).toBeDefined(); button!.click();
    };

    it("makes no request before server confirmation and requires separate content acceptance", async () => {
        click("读取邀请");
        expect(container.textContent).toContain("https://loom.example.test");
        expect(requestProjection).not.toHaveBeenCalled();
        vi.mocked(requestProjection).mockResolvedValueOnce(projectionResponse());
        click("确认地址并查看内容");
        await vi.waitFor(() => expect(container.querySelector("img")?.alt).toBe("即将接收的投射图像"));
        expect(attachProjectionReceiver).not.toHaveBeenCalled();
        vi.mocked(requestProjection).mockImplementationOnce(async (operation) => {
            if (operation.kind !== "accept") throw new Error("Unexpected operation");
            return { ...projectionResponse(), receiverUnitId: operation.receiverUnitId };
        });
        click("接收为关联贴图");
        await vi.waitFor(() => expect(attachProjectionReceiver).toHaveBeenCalledTimes(1));
        const [id, response] = vi.mocked(attachProjectionReceiver).mock.calls[0];
        expect(response.receiverUnitId).toBe(id);
    });

    it("reuses the same receiver ID after a lost response", async () => {
        vi.mocked(requestProjection).mockResolvedValueOnce(projectionResponse());
        click("读取邀请"); click("确认地址并查看内容");
        await vi.waitFor(() => expect(container.querySelector("img")).not.toBeNull());
        vi.mocked(requestProjection).mockRejectedValueOnce(new Error("projection_network_error"));
        click("接收为关联贴图");
        await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
        vi.mocked(requestProjection).mockResolvedValueOnce(projectionResponse());
        click("接收为关联贴图");
        await vi.waitFor(() => expect(attachProjectionReceiver).toHaveBeenCalledTimes(1));
        const accepts = vi.mocked(requestProjection).mock.calls.map(([operation]) => operation).filter((op) => op.kind === "accept");
        expect(accepts).toHaveLength(2);
        expect(accepts[1].receiverUnitId).toBe(accepts[0].receiverUnitId);
    });

    it("keeps an open receiver usable after an unrelated sticker is deleted", async () => {
        const unrelated = projectionUnit();
        unrelated.data.qrProjection = undefined;
        graphStore.actions.addUnit(unrelated);
        click("读取邀请");
        graphStore.actions.removeUnit(unrelated.id);
        vi.mocked(requestProjection).mockResolvedValueOnce(projectionResponse());
        click("确认地址并查看内容");
        await vi.waitFor(() => expect(container.querySelector("img")).not.toBeNull());
        vi.mocked(requestProjection).mockResolvedValueOnce(projectionResponse());
        click("接收为关联贴图");
        await vi.waitFor(() => expect(attachProjectionReceiver).toHaveBeenCalledTimes(1));
        expect(queueProjectionUnlink).not.toHaveBeenCalled();
    });

    it("does not create a late unit after closing and releases the remote acceptance", async () => {
        vi.mocked(requestProjection).mockResolvedValueOnce(projectionResponse());
        click("读取邀请"); click("确认地址并查看内容");
        await vi.waitFor(() => expect(container.querySelector("img")).not.toBeNull());
        let resolve!: (response: ReturnType<typeof projectionResponse>) => void;
        vi.mocked(requestProjection).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
        click("接收为关联贴图");
        dispose();
        resolve(projectionResponse());
        await vi.waitFor(() => expect(queueProjectionUnlink).toHaveBeenCalledWith(projectionEnvelope()));
        expect(attachProjectionReceiver).not.toHaveBeenCalled();
    });
});
