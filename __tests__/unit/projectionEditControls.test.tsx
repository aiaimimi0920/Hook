import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
    dispose = render(() => <section class="sticker-settings-panel"><div class="projection-settings-flow">
        <ProjectionEditControls unitId={role} direction={role === "source" ? "send" : "receive"} />
    </div></section>, document.body);
}

it("cleans up the native issue popup and restores focus on Escape", () => {
    mount("source");
    setProjectionEditStatuses("source", { mode: "one_way", revision: 1, pending: false, conflicts: 1 });
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="编辑需要处理"]')!;
    trigger.click();
    expect(rects()).toHaveLength(1);
    expect(document.querySelector('[aria-label="投射编辑问题"]')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(rects()).toHaveLength(0); expect(document.activeElement).toBe(trigger);
});

it("keeps receiver direction read-only and offers explicit local/remote conflict choices", async () => {
    mount("receiver");
    const indicator = document.querySelector<HTMLButtonElement>('[aria-label="双向修改"]')!;
    expect(indicator.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="单向修改"]')!.disabled).toBe(true);
    indicator.click();
    expect(rects()).toHaveLength(0);
    expect(document.querySelector('[aria-label="投射数据流向选项"]')).toBeNull();
    setProjectionEditStatuses("receiver", { mode: "one_way", revision: 3, pending: false, conflicts: 1, error: "projection_edit_read_only" });
    document.querySelector<HTMLButtonElement>('[aria-label="编辑需要处理"]')!.click();
    expect(document.querySelector('[aria-label="投射数据流向"]')).toBeNull();
    expect(textButton("保留本地修改并提交").disabled).toBe(true);
    setProjectionEditStatuses("receiver", { mode: "two_way", revision: 4, pending: false, conflicts: 1, error: "projection_edit_object_conflict" });
    expect(indicator.getAttribute("aria-pressed")).toBe("true");
    textButton("保留本地修改并提交").click();
    await vi.waitFor(() => expect(resolveProjectionEditConflict).toHaveBeenCalledWith("receiver", true));
    textButton("采用远端版本").click();
    await vi.waitFor(() => expect(resolveProjectionEditConflict).toHaveBeenCalledWith("receiver", false));
    expect(setProjectionEditMode).not.toHaveBeenCalled();
});

it("tracks source direction updates without enabling receiver controls", () => {
    mount("receiver");
    const style = document.createElement("style");
    style.textContent = readFileSync("src/styles/sticker-settings.css", "utf8")
        + readFileSync("src/styles/projection-settings.css", "utf8");
    document.body.append(style);
    const color = (button: HTMLButtonElement) => [...style.sheet!.cssRules]
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && button.matches(rule.selectorText))
        .map((rule) => rule.style.color).filter(Boolean).at(-1);
    const one = document.querySelector<HTMLButtonElement>('[aria-label="单向修改"]')!;
    const two = document.querySelector<HTMLButtonElement>('[aria-label="双向修改"]')!;
    for (const mode of ["one_way", "two_way", "one_way"] as const) {
        setProjectionEditStatuses("receiver", { mode, revision: 5, pending: false, conflicts: 0 });
        expect(one.getAttribute("aria-pressed")).toBe(String(mode === "one_way"));
        expect(two.getAttribute("aria-pressed")).toBe(String(mode === "two_way"));
        expect(one.disabled).toBe(true);
        expect(two.disabled).toBe(true);
        expect(color(mode === "one_way" ? one : two)).toBe("var(--theme-signal)");
        expect(color(mode === "one_way" ? two : one)).toBe("rgb(89, 97, 107)");
        one.click(); two.click();
    }
    expect(setProjectionEditMode).not.toHaveBeenCalled();
});

it("renders mutually exclusive inline flow buttons and waits for the source acknowledgement", async () => {
    graphStore.actions.replaceUnits([projectionUnit()]);
    setProjectionEditStatuses("source", { mode: "one_way", revision: 1, pending: false, conflicts: 0 });
    dispose = render(() => <ProjectionEditControls unitId="source" direction="send" />, document.body);
    const one = document.querySelector<HTMLButtonElement>('[aria-label="单向修改"]')!;
    const two = document.querySelector<HTMLButtonElement>('[aria-label="双向修改"]')!;
    one.click(); expect(setProjectionEditMode).not.toHaveBeenCalled();
    two.click(); await vi.waitFor(() => expect(setProjectionEditMode).toHaveBeenCalledWith("source", "two_way"));
    expect(one.getAttribute("aria-pressed")).toBe("true");
    expect(two.getAttribute("aria-pressed")).toBe("false");
    setProjectionEditStatuses("source", { mode: "two_way", revision: 2, pending: false, conflicts: 0 });
    expect(one.getAttribute("aria-pressed")).toBe("false");
    expect(two.getAttribute("aria-pressed")).toBe("true");
    expect(rects()).toHaveLength(0);
});
