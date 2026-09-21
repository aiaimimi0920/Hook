import { describe, expect, it, vi } from "vitest";
import { createDocumentBinding, type BrowserTransport } from "../../scripts/browser-candidate/documentBinding";

function fixture() {
    let loaderId = "original";
    const listeners = new Map<string, (payload: unknown) => void>();
    const screenshot = vi.fn(async () => ({ data: "png-fixture" }));
    const request = vi.fn<BrowserTransport["request"]>(async (method) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main", loaderId } } };
        if (method === "Page.captureScreenshot") return screenshot();
        return {};
    });
    const detach = vi.fn(async () => undefined);
    const transport: BrowserTransport = {
        request, detach,
        subscribe(event, listener) { listeners.set(event, listener); return () => { listeners.delete(event); }; },
    };
    return { transport, request, detach, screenshot, listeners,
        navigate() { loaderId = "replacement"; },
        emit(event: string, payload: unknown = {}) { listeners.get(event)?.(payload); },
    };
}
const region = { x: 40, y: 120, width: 320, height: 160 };

describe("candidate browser document binding", () => {
    it("copies fixed document coordinates without scrolling or focusing the target", async () => {
        const f = fixture(); const session = await createDocumentBinding(f.transport);
        const input = { ...region }; const capture = session.bind(input); input.y = 1400;
        expect(await capture()).toBe("png-fixture");
        expect(f.request).toHaveBeenCalledWith("Page.captureScreenshot", {
            format: "png", fromSurface: true, captureBeyondViewport: true, clip: { ...region, scale: 1 },
        });
        expect(f.request.mock.calls.map(([method]) => method)).toEqual([
            "Page.enable", "Page.getFrameTree", "Page.getFrameTree", "Page.captureScreenshot", "Page.getFrameTree",
        ]);
        await session.close(); expect(f.listeners.size).toBe(0); expect(f.detach).toHaveBeenCalledTimes(1);
    });
    it("rejects a replacement document before requesting pixels", async () => {
        const f = fixture(); const session = await createDocumentBinding(f.transport);
        f.navigate(); await expect(session.bind(region)()).rejects.toThrow("BROWSER_DOCUMENT_CHANGED");
        expect(f.screenshot).not.toHaveBeenCalled(); await session.close();
    });
    it("discards pixels if navigation happens during capture", async () => {
        const f = fixture(); const session = await createDocumentBinding(f.transport);
        f.screenshot.mockImplementation(async () => { f.navigate(); return { data: "wrong-document" }; });
        await expect(session.bind(region)()).rejects.toThrow("BROWSER_DOCUMENT_CHANGED");
        await session.close();
    });
    it.each(["Inspector.detached", "close", "Page.frameNavigated", "Page.frameStartedLoading"])(
        "invalidates all regions on %s and detaches only once", async (event) => {
            const f = fixture(); const session = await createDocumentBinding(f.transport);
            const a = session.bind(region); const b = session.bind({ ...region, x: 400 });
            f.emit(event, { frame: { id: "main", loaderId: "new" }, frameId: "main" });
            await expect(a()).rejects.toThrow(/BROWSER_(SOURCE_CLOSED|DOCUMENT_CHANGED)/);
            await expect(b()).rejects.toThrow(/BROWSER_(SOURCE_CLOSED|DOCUMENT_CHANGED)/);
            await session.close(); await session.close(); expect(f.detach).toHaveBeenCalledTimes(1);
            expect(f.listeners.size).toBe(0);
        },
    );
    it("does not invalidate a document because an unrelated iframe navigates", async () => {
        const f = fixture(); const session = await createDocumentBinding(f.transport);
        f.emit("Page.frameNavigated", { frame: { id: "child", parentId: "main" } });
        f.emit("Page.frameStartedLoading", { frameId: "child" });
        expect(await session.bind(region)()).toBe("png-fixture"); await session.close();
    });
    it("fails closed on malformed events instead of throwing from the event loop", async () => {
        const f = fixture(); const session = await createDocumentBinding(f.transport);
        const capture = session.bind(region);
        expect(() => f.emit("Page.frameNavigated", null)).not.toThrow();
        await expect(capture()).rejects.toThrow("BROWSER_INVALID_EVENT"); await session.close();
    });
    it("shares one in-flight slot, queues nothing and cancels pending work on revoke", async () => {
        const f = fixture(); const session = await createDocumentBinding(f.transport);
        f.screenshot.mockImplementation(() => new Promise(() => undefined));
        const first = session.bind(region)();
        const rejection = expect(first).rejects.toThrow("BROWSER_BINDING_REVOKED");
        await expect(session.bind({ ...region, x: 400 })()).rejects.toThrow("BROWSER_CAPTURE_BUSY");
        await session.close(); await rejection; expect(f.listeners.size).toBe(0);
    });
    it("bounds a stalled capture and leaves no subscribed listeners", async () => {
        const f = fixture(); const session = await createDocumentBinding(f.transport, 10);
        f.screenshot.mockImplementation(() => new Promise(() => undefined));
        await expect(session.bind(region)()).rejects.toThrow("BROWSER_CAPTURE_TIMEOUT");
        await session.close(); expect(f.listeners.size).toBe(0);
    });
    it("rejects invalid or excessive regions before any screenshot", async () => {
        const f = fixture(); const session = await createDocumentBinding(f.transport);
        for (const bad of [{ ...region, x: -1 }, { ...region, y: Infinity }, { ...region, width: 0 },
            { ...region, width: 8192, height: 8192 }]) {
            expect(() => session.bind(bad)).toThrow("BROWSER_INVALID_REGION");
        }
        expect(f.screenshot).not.toHaveBeenCalled(); await session.close();
    });
});
