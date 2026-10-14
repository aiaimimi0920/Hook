import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOverlaySyntheticDispatcher } from "../../src/services/overlaySyntheticEvents";
import { StickerClipboardHistoryPanel } from "../../src/components/StickerClipboardHistoryPanel";

const mocks = vi.hoisted(() => ({ read: vi.fn(), listen: vi.fn(), paste: vi.fn() }));
vi.mock("../../src/services/systemClipboardHistory", () => ({
    readSystemClipboardHistory: mocks.read, listenSystemClipboard: mocks.listen,
}));
vi.mock("../../src/services/stickerClipboardPaste", () => ({ pasteSystemClipboardEntry: mocks.paste }));
let dispose: (() => void) | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("system clipboard submenu", () => {
    it("scrolls and drags the actual clipboard list through native synthetic input", async () => {
        mocks.listen.mockResolvedValue(vi.fn());
        mocks.read.mockResolvedValue({ status: "ready", monitoring: true,
            entries: Array.from({ length: 25 }, (_, i) => ({ id: `${i}`, kind: "text", content: `Text ${i}` })) });
        dispose = render(() => <StickerClipboardHistoryPanel unitId="target" onDone={vi.fn()} />, document.body);
        await vi.waitFor(() => expect(document.querySelectorAll("button")).toHaveLength(25));
        const viewport = document.querySelector<HTMLDivElement>("[data-overlay-menu-scroll]")!;
        Object.defineProperties(viewport, { clientHeight: { value: 200 }, scrollHeight: { value: 1200 } });
        viewport.dispatchEvent(new Event("scroll"));
        let hit: Element = viewport.querySelector("button")!;
        const relay = createOverlaySyntheticDispatcher({ doc: document, elementFromPoint: () => hit,
            isLinking: () => false, getDraggingStickerId: () => null });
        relay.dispatch("wheel", { x: 20, y: 30, deltaY: 120 });
        expect(viewport.scrollTop).toBe(120);
        hit = document.querySelector('[role="scrollbar"]')!;
        relay.dispatch("mousedown", { x: 250, y: 30 });
        relay.dispatch("mousemove", { x: 250, y: 100 });
        relay.dispatch("mouseup", { x: 250, y: 100 });
        expect(viewport.scrollTop).toBeGreaterThan(120);
    });
    it("renders text safely, updates on system changes, pastes the selected entry, and cleans up", async () => {
        let changed = () => {};
        const stop = vi.fn();
        mocks.listen.mockImplementation(async (callback) => { changed = callback; return stop; });
        const entry = { id: "text-1", kind: "text", content: "<script>not HTML</script>" };
        mocks.read.mockResolvedValue({ status: "ready", entries: [entry] });
        mocks.paste.mockResolvedValue(undefined);
        const done = vi.fn();
        dispose = render(() => <StickerClipboardHistoryPanel unitId="target" onDone={done} />, document.body);
        await vi.waitFor(() => expect(document.querySelector("button")?.textContent).toContain(entry.content));
        expect(document.querySelector("script")).toBeNull();
        changed();
        await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
        document.querySelector("button")!.click();
        await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
        expect(mocks.paste).toHaveBeenCalledWith("target", entry, expect.any(Function));
        dispose(); dispose = undefined;
        expect(stop).toHaveBeenCalledOnce();
    });
    it("reports disabled Windows history without claiming the history is empty", async () => {
        mocks.listen.mockResolvedValue(vi.fn());
        mocks.read.mockResolvedValue({ status: "disabled", entries: [] });
        dispose = render(() => <StickerClipboardHistoryPanel unitId="target" onDone={vi.fn()} />, document.body);
        await vi.waitFor(() => expect(document.body.textContent).toContain("开启剪贴板历史"));
        expect(document.querySelector("button")).toBeNull();
    });
    it("unsubscribes when the event subscription completes after unmount", async () => {
        let resolve!: (stop: () => void) => void;
        mocks.listen.mockReturnValue(new Promise((done) => { resolve = done; }));
        mocks.read.mockResolvedValue({ status: "ready", entries: [] });
        dispose = render(() => <StickerClipboardHistoryPanel unitId="target" onDone={vi.fn()} />, document.body);
        dispose(); dispose = undefined;
        const stop = vi.fn(); resolve(stop);
        await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    });
});
