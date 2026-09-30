import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { StickerTopStrip } from "../../src/components/StickerTopStrip";
import { graphStore } from "../../src/store/graphStore";
import { projectionDialog, closeProjectionDialog } from "../../src/store/qrProjectionStore";
import { stickerToolSettings, uiActions } from "../../src/store/uiStore";
import { projectionUnit } from "../fixtures/qrProjection";

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

it("opens projection as a secondary icon tab, without creating an invitation or mutating crop mode", () => {
    expect(button("裁剪工具").classList.contains("hook-toolbar-button--active")).toBe(true);
    expect(button("投射贴图").textContent).toBe("");
    expect(button("投射贴图").querySelector("svg")).not.toBeNull();
    button("投射贴图").click();
    expect(document.querySelector('[aria-label="投射二级设置"]')).not.toBeNull();
    expect(document.querySelectorAll(".hook-toolbar-button--active")).toHaveLength(1);
    expect(button("投射贴图").getAttribute("aria-pressed")).toBe("true");
    expect(projectionDialog()).toBeUndefined();
    expect(stickerToolSettings.activeCanvasTool).toBe("crop");
    expect(document.querySelector('[aria-label="生成投射链接"]')).toBeNull();
    button("生成投射二维码").click();
    expect(projectionDialog()).toEqual({ unitId: "receiver", shareAction: "qr" });
});

it("switches to receive controls with read-only flow and persisted source information", () => {
    button("切换投射方向").click();
    const receive = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((item) => item.textContent === "被投射")!;
    receive.click();
    expect(document.querySelector('[aria-label="被投射二级设置"]')).not.toBeNull();
    const flow = document.querySelector<HTMLElement>('[aria-label="数据流向：单向修改"]')!;
    expect(flow.tagName).toBe("SPAN");
    expect(flow.getAttribute("aria-haspopup")).toBeNull();
    expect(flow.textContent).not.toContain("▾");
    flow.click();
    expect(document.querySelector('[aria-label="投射数据流向选项"]')).toBeNull();
    expect(document.querySelector('[aria-label="投射来源：PC3 - CODE"]')).not.toBeNull();
    expect(button("二维码导入")).toBeNull();
    expect(button("链接导入")).toBeNull();
    expect(button("管理投射关联")).toBeNull();
    button("导入投射").click();
    expect(projectionDialog()).toEqual({ invitationText: "", importKind: "combined", anchorUnitId: "receiver" });
});

it("restores the ordinary secondary toolbar when choosing another editing tool", () => {
    button("投射贴图").click();
    button("橡皮擦工具").click();
    expect(document.querySelector('[aria-label="投射二级设置"]')).toBeNull();
    expect(stickerToolSettings.activeCanvasTool).toBe("content-eraser");
});
it("leaves projection when reselecting the same underlying tool", () => {
    button("投射贴图").click();
    button("裁剪工具").click();
    expect(document.querySelector('[aria-label="投射二级设置"]')).toBeNull();
    expect(button("投射贴图").getAttribute("aria-pressed")).toBe("false");
    expect(button("裁剪工具").classList.contains("hook-toolbar-button--active")).toBe(true);
});
