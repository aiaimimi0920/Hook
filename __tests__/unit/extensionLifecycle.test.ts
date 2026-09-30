// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppListenerRegistry } from "../../src/services/appListenerRegistry";
import { defaultBootProfile, normalizeBootProfile } from "../../src/services/bootProfile";
import { extensionBridgeClient } from "../../src/services/extensionBridgeClient";
import { registerExtensionLifecycle } from "../../src/services/extensionLifecycle";

class TestWebSocket {
    static instances: TestWebSocket[] = [];
    readyState = 0;
    onclose: (() => void) | null = null;

    constructor(readonly url: string) {
        TestWebSocket.instances.push(this);
    }

    close(): void {
        this.readyState = 3;
        this.onclose?.();
    }
}

const registries: AppListenerRegistry[] = [];
const mount = async (endpoint?: string) => {
    const registry = new AppListenerRegistry();
    registries.push(registry);
    await registerExtensionLifecycle(registry, false, endpoint);
    return registry;
};
const connections = () => TestWebSocket.instances.map((socket) => socket.url);

beforeEach(() => {
    extensionBridgeClient.stop();
    TestWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", TestWebSocket);
});
afterEach(() => {
    registries.splice(0).forEach((registry) => registry.dispose());
    extensionBridgeClient.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("extension lifecycle bridge endpoint", () => {
    it("uses the boot endpoint for connection and reconnect, then stops on unmount", async () => {
        const profile = normalizeBootProfile({ loomHookWsUrl: "ws://127.0.0.1:48766" });
        const registry = await mount(profile.loomHookWsUrl);
        expect(connections()).toEqual([profile.loomHookWsUrl]);

        TestWebSocket.instances[0]!.close();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(connections()).toEqual([profile.loomHookWsUrl, profile.loomHookWsUrl]);

        TestWebSocket.instances[1]!.close();
        registry.dispose();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(connections()).toHaveLength(2);
        expect(extensionBridgeClient.diagnostics()).toMatchObject({ running: false, reconnectTimers: 0 });
    });

    it("does not carry a previous mount's endpoint into an unconfigured mount", async () => {
        const registry = await mount("ws://127.0.0.1:48766");
        registry.dispose();
        await mount();
        expect(connections()).toEqual(["ws://127.0.0.1:48766", defaultBootProfile.loomHookWsUrl]);
    });
});
