// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppListenerRegistry } from "../../src/services/appListenerRegistry";
import { extensionBridgeClient } from "../../src/services/extensionBridgeClient";
import { registerExtensionLifecycle } from "../../src/services/extensionLifecycle";

const native = vi.hoisted(() => ({ instances: [] as { close: () => void }[] }));
vi.mock("../../src/services/extensionNativeTransport", () => ({
    ExtensionNativeTransport: class {
        readyState = 0;
        onclose: (() => void) | null = null;
        constructor() { native.instances.push(this); }
        close() { this.readyState = 3; this.onclose?.(); }
    },
}));

const registries: AppListenerRegistry[] = [];
const mount = async () => {
    const registry = new AppListenerRegistry();
    registries.push(registry);
    await registerExtensionLifecycle(registry, false);
    return registry;
};

beforeEach(() => {
    extensionBridgeClient.stop();
    native.instances.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", vi.fn(() => { throw new Error("Browser networking forbidden"); }));
});
afterEach(() => {
    registries.splice(0).forEach((registry) => registry.dispose());
    extensionBridgeClient.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("extension lifecycle native bridge", () => {
    it("uses native discovery for connection and reconnect, then stops on unmount", async () => {
        const registry = await mount();
        expect(native.instances).toHaveLength(1);

        native.instances[0]!.close();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(native.instances).toHaveLength(2);

        native.instances[1]!.close();
        registry.dispose();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(native.instances).toHaveLength(2);
        expect(WebSocket).not.toHaveBeenCalled();
        expect(extensionBridgeClient.diagnostics()).toMatchObject({ running: false, reconnectTimers: 0 });
    });

    it("a new mount has a fresh native owner", async () => {
        const registry = await mount();
        registry.dispose();
        await mount();
        expect(native.instances).toHaveLength(2);
        expect(WebSocket).not.toHaveBeenCalled();
    });
});
