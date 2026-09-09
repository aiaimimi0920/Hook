import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { registerLiveGpuPreview } from "../../src/services/liveGpuPreview";

const state = vi.hoisted(() => ({ edit: null as string | null, drag: null as string | null, enabled: true, id: "live-test", sourceKind: "window" }));
const invoke = vi.hoisted(() => vi.fn());
const handoff = vi.hoisted(() => vi.fn());
const presenting = vi.hoisted(() => vi.fn());
vi.mock("../../src/services/liveCapturePollCadence", () => ({ setLiveGpuPresenting: presenting }));
vi.mock("../../src/services/liveCaptureHandoff", () => ({ refreshLiveCaptureHandoff: handoff }));
vi.mock("../../src/services/apiTransport", () => ({ safeInvoke: invoke, isTauriRuntimeAvailable: () => true }));
vi.mock("../../src/store/graphStore", () => ({ graphStore: { units: [{ id: "live-test" }] } }));
vi.mock("../../src/store/liveCaptureStore", () => ({ liveCaptureViews: [{ sessionId: "live-test",
    status: { captureState: "streaming", get sourceKind() { return state.sourceKind; } } }] }));
vi.mock("../../src/store/uiStore", () => ({
    activeStickerEditTargetId: () => state.edit, draggingStickerId: () => state.drag, isSelecting: () => false,
}));
vi.mock("../../src/services/uiRegistry", () => ({ extraRects: () => [] }));

const status = { available: true, presenting: true, submittedFrames: 7, replacedFrames: 0 };
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };
let dispose: (() => void) | undefined;
let host: HTMLDivElement;

function mount(natural = { width: 200, height: 100 }, rect = new DOMRect(100, 50, 200, 100)) {
    let image!: HTMLImageElement;
    dispose = render(() => <div class="unit-container"><div class="sticker-visual">
        <img ref={(element) => {
            image = element;
            Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: natural.width }, naturalHeight: { value: natural.height } });
            image.getBoundingClientRect = () => rect;
            registerLiveGpuPreview(image, () => state.id, () => false);
        }} />
    </div></div>, host);
    return image;
}

beforeEach(() => {
    vi.useFakeTimers();
    state.edit = null; state.drag = null; state.enabled = true;
    state.id = "live-test";
    state.sourceKind = "window";
    host = document.createElement("div"); document.body.append(host);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ opacity: "1", transform: "none", objectFit: "contain", objectPosition: "50% 50%" } as CSSStyleDeclaration);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    invoke.mockReset();
    handoff.mockReset().mockResolvedValue(undefined);
    presenting.mockReset();
    invoke.mockImplementation(async (command: string) => command === "get_live_gpu_preview_capability" ? state.enabled : status);
});

afterEach(async () => {
    dispose?.(); dispose = undefined;
    await flush(); host.remove();
    vi.restoreAllMocks(); vi.useRealTimers();
});

describe("GPU mirror Unit lifecycle", () => {
    it("activates DPI-rounded strips using contained pixels without changing the DOM box", async () => {
        const image = mount({ width: 655, height: 67 }, new DOMRect(100, 50, 436, 44));
        await flush();
        expect(image.dataset.liveGpuPreview).toBe("gpu-mirror");
        const layout = invoke.mock.calls.at(-1)?.[1].layout;
        expect(layout.width / layout.height).toBeCloseTo(655 / 67, 10);
        expect(image.getBoundingClientRect().width).toBe(436);
    });

    it("keeps unsupported object positioning on the ordinary image path", async () => {
        vi.mocked(window.getComputedStyle).mockReturnValue({ opacity: "1", transform: "none", objectFit: "contain", objectPosition: "0% 0%" } as CSSStyleDeclaration);
        const image = mount(); await flush();
        expect(image.dataset.liveGpuPreview).toBe("jpeg");
        expect(invoke.mock.calls.at(-1)?.[1].layout).toBeNull();
    });
    it("keeps ordinary rendering and visibility budgets when GPU is opted out", async () => {
        state.enabled = false;
        const image = mount(); await flush();
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(invoke).toHaveBeenLastCalledWith("configure_live_gpu_preview", { sessionId: "live-test", layout: null, visible: true });
        expect(image.dataset.liveGpuPreview).toBe("jpeg");
        expect(image.style.visibility).toBe("");
    });

    it("publishes diagnostic state only after native submission", async () => {
        const image = mount(); await flush();
        expect(image.dataset.liveGpuPreview).toBe("gpu-mirror");
        expect(image.dataset.liveGpuSubmitted).toBe("7");
        expect(presenting).toHaveBeenCalledWith("live-test", true);
        expect(image.style.visibility).toBe("");
    });

    it.each(["data-sticker-annotation-id", "data-hook-unit-notice-layer"])("suspends for %s overlays", async (attribute) => {
        mount(); await flush();
        const overlay = document.createElement("div"); overlay.setAttribute(attribute, "test");
        host.querySelector(".unit-container")!.append(overlay);
        await vi.advanceTimersByTimeAsync(80);
        expect(invoke).toHaveBeenLastCalledWith("configure_live_gpu_preview", { sessionId: "live-test", layout: null, visible: true });
    });

    it.each(["edit", "drag"] as const)("suspends during shared %s state", async (kind) => {
        mount(); await flush(); state[kind] = "live-test";
        window.dispatchEvent(new Event("resize")); await flush();
        expect(invoke).toHaveBeenLastCalledWith("configure_live_gpu_preview", { sessionId: "live-test", layout: null, visible: true });
    });

    it("serializes cleanup behind an in-flight activation", async () => {
        let resolve!: (value: typeof status) => void;
        invoke.mockImplementation((command: string, args?: { layout: unknown }) => {
            if (command === "get_live_gpu_preview_capability") return Promise.resolve(true);
            if (args?.layout) return new Promise<typeof status>((done) => { resolve = done; });
            return Promise.resolve(status);
        });
        const image = mount(); await flush();
        dispose?.(); dispose = undefined;
        resolve(status); await flush();
        expect(image.dataset.liveGpuPreview).toBeUndefined();
        expect(invoke).toHaveBeenLastCalledWith("configure_live_gpu_preview", { sessionId: "live-test", layout: null, visible: true });
    });

    it("keeps the native cover until the retained fallback has been decoded", async () => {
        let finish!: () => void;
        handoff.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
        mount(); await flush(); state.drag = "live-test";
        window.dispatchEvent(new Event("resize")); await flush();
        expect(handoff).toHaveBeenCalledWith("live-test");
        expect(invoke.mock.calls.at(-1)?.[1].layout).not.toBeNull();
        finish(); await flush();
        expect(invoke).toHaveBeenLastCalledWith("configure_live_gpu_preview", { sessionId: "live-test", layout: null, visible: true });
    });

    it("still removes the cover after a failed handoff", async () => {
        handoff.mockRejectedValue(new Error("device lost"));
        mount(); await flush(); state.drag = "live-test";
        window.dispatchEvent(new Event("resize")); await flush();
        expect(invoke).toHaveBeenLastCalledWith("configure_live_gpu_preview", { sessionId: "live-test", layout: null, visible: true });
    });

    it("disables a late activation for a replaced Unit identity", async () => {
        let finish!: (value: typeof status) => void;
        invoke.mockImplementation((command: string, args?: { layout: unknown }) => {
            if (command === "get_live_gpu_preview_capability") return Promise.resolve(true);
            if (args?.layout) return new Promise<typeof status>((resolve) => { finish = resolve; });
            return Promise.resolve(status);
        });
        const image = mount(); await flush();
        state.id = "live-replacement";
        finish(status); await flush();
        expect(invoke).toHaveBeenLastCalledWith("configure_live_gpu_preview", { sessionId: "live-test", layout: null, visible: true });
        expect(image.dataset.liveGpuPreview).not.toBe("gpu-mirror");
    });

    it("lowers hidden and fully offscreen demand, then restores it on return", async () => {
        const image = mount(); await flush();
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange")); await flush();
        expect(invoke).toHaveBeenLastCalledWith("configure_live_gpu_preview", { sessionId: "live-test", layout: null, visible: false });
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        image.getBoundingClientRect = () => new DOMRect(-300, 50, 200, 100);
        const count = invoke.mock.calls.length;
        await vi.advanceTimersByTimeAsync(80);
        expect(invoke.mock.calls.length).toBe(count);
        image.getBoundingClientRect = () => new DOMRect(100, 50, 200, 100);
        await vi.advanceTimersByTimeAsync(80);
        expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ visible: true });
        expect(invoke.mock.calls.at(-1)?.[1].layout).not.toBeNull();
    });

    it("does not pile up IPC when the shared clock ticks during a slow activation", async () => {
        let finish!: (value: typeof status) => void;
        invoke.mockImplementation((command: string) => command === "get_live_gpu_preview_capability"
            ? Promise.resolve(true) : new Promise<typeof status>((resolve) => { finish = resolve; }));
        mount(); await flush();
        await vi.advanceTimersByTimeAsync(400);
        expect(invoke.mock.calls.filter(([command]) => command === "configure_live_gpu_preview")).toHaveLength(1);
        finish(status); await flush();
    });

    it("continues visibility updates after a GPU device fault without retrying activation", async () => {
        invoke.mockImplementation(async (command: string) => command === "get_live_gpu_preview_capability"
            ? true : { ...status, presenting: false, error: "device lost" });
        mount(); await flush();
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange")); await flush();
        expect(invoke).toHaveBeenLastCalledWith("configure_live_gpu_preview", { sessionId: "live-test", layout: null, visible: false });
        const count = invoke.mock.calls.length;
        await vi.advanceTimersByTimeAsync(320);
        expect(invoke.mock.calls.length).toBe(count);
    });

    it("does not commit stale visibility after a delayed handoff", async () => {
        let finish!: () => void;
        handoff.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
        mount(); await flush();
        state.drag = "live-test";
        window.dispatchEvent(new Event("resize")); await flush();
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        finish(); await flush();
        expect(invoke).toHaveBeenLastCalledWith("configure_live_gpu_preview", { sessionId: "live-test", layout: null, visible: false });
    });
});
