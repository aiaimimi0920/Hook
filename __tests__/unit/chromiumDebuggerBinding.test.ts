import { describe, expect, it, vi } from "vitest";
import { openChromiumDocument, type ChromiumDebuggerApi } from "../../scripts/browser-candidate/chromiumDebuggerBinding";

function events<T extends (...args: never[]) => void>() {
    const listeners = new Set<T>();
    return { listeners, addListener: (listener: T) => { listeners.add(listener); },
        removeListener: (listener: T) => { listeners.delete(listener); } };
}
function fixture() {
    const onEvent = events<Parameters<ChromiumDebuggerApi["onEvent"]["addListener"]>[0]>();
    const onDetach = events<Parameters<ChromiumDebuggerApi["onDetach"]["addListener"]>[0]>();
    const api = {
        onEvent, onDetach, attach: vi.fn(async () => undefined), detach: vi.fn(async () => undefined),
        sendCommand: vi.fn<ChromiumDebuggerApi["sendCommand"]>(async (_, method) => {
            if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main", loaderId: "document" } } };
            return { data: "fixture-png" };
        }),
    };
    return { api, abort: new AbortController() };
}
const region = { x: 10, y: 100, width: 100, height: 100 };

describe("Chromium debugger document transport", () => {
    it("pins commands to the granted tab and detaches once on close", async () => {
        const f = fixture(); const binding = await openChromiumDocument(f.api, 7, f.abort.signal);
        expect(await binding.bind(region)()).toBe("fixture-png");
        expect(f.api.attach).toHaveBeenCalledWith({ tabId: 7 }, "1.3");
        expect(f.api.sendCommand.mock.calls.every(([target]) => target.tabId === 7)).toBe(true);
        await binding.close(); await binding.close();
        expect(f.api.detach).toHaveBeenCalledTimes(1);
        expect(f.api.onEvent.listeners.size + f.api.onDetach.listeners.size).toBe(0);
    });
    it("does not attach when already revoked", async () => {
        const f = fixture(); f.abort.abort();
        await expect(openChromiumDocument(f.api, 7, f.abort.signal)).rejects.toThrow("BROWSER_BINDING_REVOKED");
        expect(f.api.attach).not.toHaveBeenCalled();
    });
    it("rejects duplicate owners and allows rebind after release", async () => {
        const f = fixture(); const binding = await openChromiumDocument(f.api, 7, f.abort.signal);
        await expect(openChromiumDocument(f.api, 7, f.abort.signal)).rejects.toThrow("BROWSER_TARGET_BUSY");
        await binding.close(); const next = await openChromiumDocument(f.api, 7, f.abort.signal);
        await next.close();
    });
    it("ignores other tabs and child sessions, but invalidates its own document", async () => {
        const f = fixture(); const binding = await openChromiumDocument(f.api, 7, f.abort.signal);
        const capture = binding.bind(region);
        for (const listener of f.api.onEvent.listeners) {
            listener({ tabId: 8 }, "Page.frameNavigated", { frame: { id: "main" } });
            listener({ tabId: 7, sessionId: "child" }, "Page.frameNavigated", { frame: { id: "child" } });
        }
        expect(await capture()).toBe("fixture-png");
        for (const listener of f.api.onEvent.listeners) listener({ tabId: 7 }, "Page.frameNavigated", { frame: { id: "main" } });
        await expect(capture()).rejects.toThrow("BROWSER_DOCUMENT_CHANGED"); await binding.close();
    });
    it("releases ownership when the browser revokes its debugger", async () => {
        const f = fixture(); const binding = await openChromiumDocument(f.api, 7, f.abort.signal);
        const capture = binding.bind(region);
        for (const listener of f.api.onDetach.listeners) listener({ tabId: 7 }, "canceled_by_user");
        await expect(capture()).rejects.toThrow("BROWSER_SOURCE_CLOSED"); await binding.close();
        expect(f.api.detach).not.toHaveBeenCalled();
        const next = await openChromiumDocument(f.api, 7, f.abort.signal); await next.close();
    });
    it("cleans up an attachment which resolves after revocation", async () => {
        const f = fixture(); let finish!: () => void;
        f.api.attach.mockImplementation(() => new Promise((resolve) => { finish = () => resolve(undefined); }));
        const opening = openChromiumDocument(f.api, 7, f.abort.signal);
        const rejected = expect(opening).rejects.toThrow("BROWSER_BINDING_REVOKED");
        await Promise.resolve(); f.abort.abort(); await rejected;
        expect(f.api.detach).not.toHaveBeenCalled(); finish();
        await vi.waitFor(() => expect(f.api.detach).toHaveBeenCalledTimes(1));
        expect(f.api.onEvent.listeners.size + f.api.onDetach.listeners.size).toBe(0);
    });
    it("does not detach another debugger after attach rejection", async () => {
        const f = fixture(); f.api.attach.mockRejectedValue(new Error("already attached"));
        await expect(openChromiumDocument(f.api, 7, f.abort.signal)).rejects.toThrow("already attached");
        expect(f.api.detach).not.toHaveBeenCalled();
        expect(f.api.onEvent.listeners.size + f.api.onDetach.listeners.size).toBe(0);
    });
    it("reports an attach timeout and releases a later successful attachment", async () => {
        const f = fixture(); let finish!: () => void;
        f.api.attach.mockImplementation(() => new Promise((resolve) => { finish = () => resolve(undefined); }));
        await expect(openChromiumDocument(f.api, 7, f.abort.signal, 10)).rejects.toThrow("BROWSER_ATTACH_TIMEOUT");
        finish(); await vi.waitFor(() => expect(f.api.detach).toHaveBeenCalledTimes(1));
    });
});
