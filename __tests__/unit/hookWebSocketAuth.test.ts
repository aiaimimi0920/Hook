import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedHookWebSocket, setBrowserLoomToken, validateHookSocketEndpoint } from "../../src/services/hookWebSocketAuth";
import { ExtensionBridgeClient } from "../../src/services/extensionBridgeClient";

const core = vi.hoisted(() => ({ isTauri: vi.fn(() => false), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => core);

afterEach(() => {
    setBrowserLoomToken(null);
    core.isTauri.mockReturnValue(false);
    core.invoke.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("local Hook transport authorization", () => {
    it("bounds native credential acquisition and never opens a socket on a late reply", async () => {
        vi.useFakeTimers();
        core.isTauri.mockReturnValue(true);
        let resolve!: (value: { url: string; protocols: string[] }) => void;
        core.invoke.mockReturnValue(new Promise<{ url: string; protocols: string[] }>((done) => { resolve = done; }));
        const construct = vi.fn();
        vi.stubGlobal("WebSocket", construct);
        const result = createAuthenticatedHookWebSocket("ws://127.0.0.1:19820");
        const rejected = expect(result).rejects.toThrow("timed out");
        await vi.advanceTimersByTimeAsync(5000);
        await rejected;
        resolve({ url: "ws://127.0.0.1:19820", protocols: ["loom.hook.v1", "loom.auth.c2VjcmV0"] });
        await Promise.resolve();
        expect(construct).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
    it("uses the broker canonical URL rather than the requested loopback alias", async () => {
        core.isTauri.mockReturnValue(true);
        const credential = { url: "ws://127.0.0.1:19820", protocols: ["loom.hook.v1", "loom.auth.scoped"] };
        core.invoke.mockResolvedValue(credential);
        const constructed: unknown[][] = [];
        vi.stubGlobal("WebSocket", class { constructor(...args: unknown[]) { constructed.push(args); } });
        await createAuthenticatedHookWebSocket("ws://[::1]:19820");
        expect(constructed).toEqual([[credential.url, credential.protocols]]);
        core.invoke.mockRejectedValue(new Error("bridge unavailable"));
        await expect(createAuthenticatedHookWebSocket("ws://[::1]:19820")).rejects.toThrow("unavailable");
        expect(constructed).toHaveLength(1);
    });
    it("fails closed without a credential before opening a socket", async () => {
        const construct = vi.fn();
        vi.stubGlobal("WebSocket", construct);
        await expect(createAuthenticatedHookWebSocket("ws://127.0.0.1:19820")).rejects.toThrow("authentication");
        expect(construct).not.toHaveBeenCalled();
    });

    it("offers an encoded credential separately from the URL", async () => {
        const constructed: unknown[][] = [];
        vi.stubGlobal("WebSocket", class { constructor(...args: unknown[]) { constructed.push(args); } });
        expect(() => setBrowserLoomToken("administrator-secret")).toThrow("Invalid");
        expect(constructed).toHaveLength(0);
        setBrowserLoomToken("hook-v1.local-secret");
        await createAuthenticatedHookWebSocket("ws://127.0.0.1:19820");
        expect(constructed).toEqual([["ws://127.0.0.1:19820", ["loom.hook.v1", `loom.auth.${btoa("hook-v1.local-secret").replace(/=+$/u, "")}`]]]);
    });

    it("never sends local authority to a remote or credential-bearing URL", () => {
        for (const endpoint of ["ws://evil.example", "ws://127.0.0.1/?token=x", "ws://user@localhost", "ws://localhost.evil.example"]) {
            expect(() => validateHookSocketEndpoint(endpoint)).toThrow();
        }
    });

    it("closes a late authenticated socket after the extension lifecycle stops", async () => {
        let resolve!: (socket: WebSocket) => void;
        const socket = { close: vi.fn() };
        const client = new ExtensionBridgeClient(() => new Promise<WebSocket>((done) => { resolve = done; }));
        const stop = client.start();
        stop();
        resolve(socket as unknown as WebSocket);
        await Promise.resolve();
        expect(socket.close).toHaveBeenCalledOnce();
        expect(client.diagnostics().running).toBe(false);
    });
});
