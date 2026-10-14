import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { StickerTopStrip } from "../../src/components/StickerTopStrip";
import { graphStore } from "../../src/store/graphStore";
import { projectionDialog, closeProjectionDialog } from "../../src/store/qrProjectionStore";
import { stickerToolSettings, uiActions } from "../../src/store/uiStore";
import { projectionUnit } from "../fixtures/qrProjection";
import { patchProjection } from "../../src/services/qrProjectionSession";

vi.mock("../../src/services/syncService", () => ({ syncService: {
    updateBackendRects: vi.fn().mockResolvedValue(undefined), performWorkflowSync: vi.fn().mockResolvedValue(undefined),
} }));
vi.mock("../../src/services/projectionEditJournal", () => ({
    loadProjectionEdit: async () => undefined, saveProjectionEdit: vi.fn(), forgetProjectionEdit: async () => undefined,
}));
let dispose: () => void;
const button = (label: string) => document.querySelector<HTMLButtonElement>('[aria-label="' + label + '"]')!;
beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    closeProjectionDialog();
    const unit = projectionUnit("receiver"); unit.data.qrProjection!.sourceName = "PC3 - CODE";
    graphStore.actions.replaceUnits([unit]);
    uiActions.setStickerEditMode("crop");
    const host = document.createElement("div"); document.body.append(host);
    dispose = render(() => <StickerTopStrip unitId={unit.id} x={100} y={200} stickerWidth={320} stickerHeight={180} />, host);
});
afterEach(() => { dispose(); graphStore.actions.replaceUnits([]); document.body.replaceChildren(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("mounts projection under settings instead of the main toolbar without mutating crop mode", () => {
    expect(button("裁剪工具").classList.contains("otter-toolbar-button--active")).toBe(true);
    expect(button("投射贴图")).toBeNull();
    button("贴图设置").click();
    expect(document.querySelector('[aria-label="投射设置"]')).not.toBeNull();
    expect(document.querySelector('.sticker-settings-stack')?.children).toHaveLength(2);
    expect(projectionDialog()).toBeUndefined();
    expect(stickerToolSettings.activeCanvasTool).toBe("crop");
    button("投射").click();
    expect(button("导出二维码").disabled).toBe(true);
    patchProjection("receiver", undefined);
    button("导出二维码").click();
    expect(projectionDialog()).toEqual({ unitId: "receiver", shareAction: "qr" });
});

it("switches to receive controls with read-only flow and persisted source information", () => {
    button("贴图设置").click();
    expect(button("被投射").getAttribute("aria-selected")).toBe("true");
    expect(button("单向修改").disabled).toBe(true);
    expect(button("双向修改").disabled).toBe(true);
    expect(document.querySelector('[aria-label="投射数据流向选项"]')).toBeNull();
    expect(document.querySelector('.projection-settings-source code')?.textContent).toBe(graphStore.units[0].data.qrProjection?.envelope.projectionId);
    expect(button("管理投射关联")).toBeNull();
    button("导入二维码").click();
    expect(projectionDialog()).toEqual({ invitationText: "", importKind: "qr", anchorUnitId: "receiver" });
    button("导入链接").click();
    expect(projectionDialog()).toEqual({ invitationText: "", importKind: "link", anchorUnitId: "receiver" });
});

it("closes settings when choosing another editing tool", () => {
    button("贴图设置").click();
    button("橡皮擦工具").click();
    expect(document.querySelector('[aria-label="投射设置"]')).toBeNull();
    expect(stickerToolSettings.activeCanvasTool).toBe("content-eraser");
});
it("keeps the source ID while unlink is pending and clears only after acknowledgement", () => {
    button("贴图设置").click();
    const id = graphStore.units[0].data.qrProjection!.envelope.projectionId;
    button("退出被投射").click();
    expect(graphStore.units[0].data.qrProjection!.stopPending).toBe(true);
    expect(document.querySelector('.projection-settings-source code')?.textContent).toBe(id);
    expect(button("退出被投射").disabled).toBe(true);
    patchProjection("receiver", undefined);
    expect(document.querySelector('.projection-settings-source code')?.textContent).toBe("-");
    expect(button("复制来源 ID").disabled).toBe(true);
});
