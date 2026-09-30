import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ProjectionEditControls } from "../../src/components/ProjectionEditControls";
import { graphStore } from "../../src/store/graphStore";
import { projectionEditStatuses, setProjectionEditStatuses, setProjectionEditMode, resolveProjectionEditConflict } from "../../src/services/projectionEditSession";
import { extraRects } from "../../src/services/uiRegistry";
import { projectionUnit } from "../fixtures/qrProjection";

vi.mock("../../src/services/projectionEditSession", async () => {
    const { createStore } = await import("solid-js/store");
    const [statuses, setStatuses] = createStore({});
    return { projectionEditStatuses: statuses, setProjectionEditStatuses: setStatuses,
        projectionEditing: { inspect: vi.fn(async () => undefined) },
        setProjectionEditMode: vi.fn(async () => undefined), resolveProjectionEditConflict: vi.fn(async () => undefined) };
});
vi.mock("../../src/services/syncService", () => ({ syncService: { updateBackendRects: async () => undefined } }));
let dispose: (() => void) | undefined;
const textButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text)!;
const flow = () => document.querySelector<HTMLButtonElement>('button[aria-label^="数据流向"]')!;
const rects = () => extraRects().filter((rect) => rect.id.startsWith("projection-target-popover-"));
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(() => {
    dispose?.(); graphStore.actions.replaceUnits([]); document.body.replaceChildren();
    for (const id of Object.keys(projectionEditStatuses)) setProjectionEditStatuses(id, undefined);
    vi.clearAllMocks(); vi.unstubAllGlobals();
});
function mount(role: "source" | "receiver") {
    graphStore.actions.replaceUnits([projectionUnit(role)]);
    setProjectionEditStatuses(role, { mode: "one_way", revision: 1, pending: false, conflicts: 0 });
    dispose = render(() => <ProjectionEditControls unitId={role} direction={role === "source" ? "send" : "receive"} />, document.body);
    if (role === "source") flow().click();
}

it("uses the native popup for source mode control and displays the authoritative acknowledgment", async () => {
    mount("source"); expect(rects()).toHaveLength(1);
    expect(document.querySelectorAll('[aria-label="投射数据流向选项"] button')).toHaveLength(2);
    expect(flow().textContent).toBe("▾");
    expect(document.querySelector('[aria-label="投射数据流向"] p')).toBeNull();
    document.querySelector<HTMLButtonElement>('[aria-label="双向修改"]')!.click();
    await vi.waitFor(() => expect(setProjectionEditMode).toHaveBeenCalledWith("source", "two_way"));
    expect(flow().getAttribute("aria-label")).toBe("数据流向：单向修改");
    setProjectionEditStatuses("source", { mode: "two_way", revision: 2, pending: false, conflicts: 0 });
    expect(flow().getAttribute("aria-label")).toBe("数据流向：双向修改");
    expect(rects()).toHaveLength(0);
    flow().click();
    const trigger = flow();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(rects()).toHaveLength(0); expect(document.activeElement).toBe(trigger);
});

it("keeps receiver direction read-only and offers explicit local/remote conflict choices", async () => {
    mount("receiver");
    expect(flow()).toBeNull();
    const indicator = document.querySelector<HTMLElement>('[role="img"][aria-label="数据流向：单向修改"]')!;
    indicator.click();
    expect(rects()).toHaveLength(0);
    expect(document.querySelector('[aria-label="投射数据流向选项"]')).toBeNull();
    setProjectionEditStatuses("receiver", { mode: "one_way", revision: 3, pending: false, conflicts: 1, error: "projection_edit_read_only" });
    document.querySelector<HTMLButtonElement>('[aria-label="编辑需要处理"]')!.click();
    expect(document.querySelector('[aria-label="投射数据流向"]')).toBeNull();
    expect(textButton("保留本地修改并提交").disabled).toBe(true);
    setProjectionEditStatuses("receiver", { mode: "two_way", revision: 4, pending: false, conflicts: 1, error: "projection_edit_object_conflict" });
    expect(indicator.getAttribute("aria-label")).toBe("数据流向：双向修改");
    textButton("保留本地修改并提交").click();
    await vi.waitFor(() => expect(resolveProjectionEditConflict).toHaveBeenCalledWith("receiver", true));
    textButton("采用远端版本").click();
    await vi.waitFor(() => expect(resolveProjectionEditConflict).toHaveBeenCalledWith("receiver", false));
    expect(setProjectionEditMode).not.toHaveBeenCalled();
});
