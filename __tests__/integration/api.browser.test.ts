import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserGlobals, MockWebSocket } from "../helpers/browserApiTestHarness";

describe("Hook standalone browser trust boundary", () => {
    beforeEach(() => {
        vi.resetModules();
        MockWebSocket.instances = [];
        vi.unstubAllGlobals();
        installBrowserGlobals();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each([
        "loom.hook.handshake", "loom.hook.subscribe", "loom.hook.workflow.sync",
        "loom.hook.workflow.node.update", "loom.hook.art.execute", "loom.extension.handshake",
    ])("rejects %s without opening an anonymous socket", async (method) => {
        const { browserLoomHookRequest, loomHookRequest, NATIVE_LOOM_REQUIRED } =
            await import("../../src/services/apiBrowserLoomTransport");
        await expect(browserLoomHookRequest({ method, params: { requestId: "test" } }))
            .rejects.toThrow(NATIVE_LOOM_REQUIRED);
        await expect(loomHookRequest(method)).rejects.toThrow(NATIVE_LOOM_REQUIRED);
        expect(MockWebSocket.instances).toHaveLength(0);
    });

    it("returns an isolated local preview handshake even if WebSocket is available", async () => {
        const { browserHandshakeFallback } = await import("../../src/services/apiBrowserLoomTransport");
        const first = await browserHandshakeFallback();
        expect(first.serverName).toBe("browser-preview");
        expect(first.capabilities.artDefinitions).toEqual([]);
        first.capabilities.operations.push("untrusted");
        expect((await browserHandshakeFallback()).capabilities.operations).toEqual([]);
        expect(MockWebSocket.instances).toHaveLength(0);
    });

    it("does not open push sockets or schedule retries for browser listeners", async () => {
        vi.useFakeTimers();
        const { listenBrowserLoomHookMethod } = await import("../../src/services/api");
        const handler = vi.fn();
        const stopWorkflow = listenBrowserLoomHookMethod("loom.hook.workflow.instantiated", handler);
        const stopArt = listenBrowserLoomHookMethod("loom.hook.art.progress", handler);
        await vi.advanceTimersByTimeAsync(60_000);
        stopWorkflow();
        stopArt();
        stopArt();
        expect(handler).not.toHaveBeenCalled();
        expect(MockWebSocket.instances).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(["sync_workflow", "update_workflow_node", "cancel_art"])(
        "does not send %s from browser preview", async (action) => {
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const { api } = await import("../../src/services/api");
            await api.dispatchAction({ action, payload: { request_id: "request", node_id: "node" } });
            expect(MockWebSocket.instances).toHaveLength(0);
        },
    );

    it("fails Art execution locally without preparing inputs or fabricating a result", async () => {
        const { api } = await import("../../src/services/api");
        const ready = vi.fn();
        const readInputs = vi.fn(() => { throw new Error("Must not read images in unsupported preview execution"); });
        window.addEventListener("hook-browser-art-ready", ready);
        const payload = { node_id: "node", request_id: "request" };
        Object.defineProperty(payload, "inputs", { get: readInputs });
        await api.dispatchAction({ action: "execute_art", payload });
        expect(readInputs).not.toHaveBeenCalled();
        expect(ready).toHaveBeenCalledOnce();
        expect((ready.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
            art_id: "node", request_id: "request", status: 500,
            error: "Loom integration requires the authenticated native desktop runtime",
        });
        expect(MockWebSocket.instances).toHaveLength(0);
    });

    it.each([null, {}, { node_id: 1, request_id: "r" }])(
        "does not dispatch malformed local Art identities", async (payload) => {
            const { api } = await import("../../src/services/api");
            const ready = vi.fn();
            window.addEventListener("hook-browser-art-ready", ready);
            await api.dispatchAction({ action: "execute_art", payload });
            expect(ready).not.toHaveBeenCalled();
            expect(MockWebSocket.instances).toHaveLength(0);
        },
    );
});
