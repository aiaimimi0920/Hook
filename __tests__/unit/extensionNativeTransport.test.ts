import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionNativeTransport } from "../../src/services/extensionNativeTransport";

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
};
const result = (extra = {}) => ({ epoch: "epoch-1", connected: true, closed: false, message: null, ...extra });
const setup = () => {
    const native = vi.fn(async (command: string, _args?: Record<string, unknown>): Promise<unknown> => {
        if (command === "extension_bridge_open") return "epoch-1";
        if (command === "extension_bridge_poll") return result();
        return undefined;
    });
    const socket = new ExtensionNativeTransport(native as ConstructorParameters<typeof ExtensionNativeTransport>[0]);
    const opened = vi.fn();
    const message = vi.fn();
    const closed = vi.fn();
    socket.onopen = opened;
    socket.onmessage = message;
    socket.onclose = closed;
    return { native, socket, opened, message, closed };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("native extension transport", () => {
    it("uses narrow IPC without URLs, opens once, and releases its epoch on close", async () => {
        const { native, socket, opened, closed } = setup();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(100);
        expect(opened).toHaveBeenCalledTimes(1);
        expect(native.mock.calls[0]).toEqual(["extension_bridge_open"]);
        socket.send("protocol message");
        await vi.advanceTimersByTimeAsync(0);
        expect(native).toHaveBeenCalledWith("extension_bridge_send", { epoch: "epoch-1", text: "protocol message" });
        socket.close();
        socket.close();
        expect(closed).toHaveBeenCalledTimes(1);
        expect(native).toHaveBeenCalledWith("extension_bridge_close", { epoch: "epoch-1" });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("releases a native open that completes after unmount without reopening the UI session", async () => {
        const { native, socket, opened } = setup();
        const pending = deferred<string>();
        native.mockImplementationOnce(() => pending.promise);
        await vi.advanceTimersByTimeAsync(0);
        socket.close();
        pending.resolve("late-epoch");
        await vi.advanceTimersByTimeAsync(0);
        expect(opened).not.toHaveBeenCalled();
        expect(native).toHaveBeenCalledWith("extension_bridge_close", { epoch: "late-epoch" });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("discards a poll response that arrives after close", async () => {
        const { native, socket, message } = setup();
        await vi.advanceTimersByTimeAsync(0);
        const pending = deferred<unknown>();
        native.mockImplementationOnce(() => pending.promise);
        await vi.advanceTimersByTimeAsync(50);
        socket.close();
        pending.resolve(result({ message: "late payload" }));
        await vi.advanceTimersByTimeAsync(0);
        expect(message).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("rejects a response from another epoch without dispatching its payload", async () => {
        const { native, socket, message, closed } = setup();
        await vi.advanceTimersByTimeAsync(0);
        native.mockResolvedValueOnce(result({ epoch: "stale", message: "wrong payload" }));
        await vi.advanceTimersByTimeAsync(50);
        expect(message).not.toHaveBeenCalled();
        expect(closed).toHaveBeenCalledTimes(1);
        expect(socket.readyState).toBe(3);
    });

    it("serializes sends and bounds pending work even when native IPC stalls", async () => {
        const { native, socket } = setup();
        await vi.advanceTimersByTimeAsync(0);
        const pending = deferred<unknown>();
        native.mockImplementationOnce(() => pending.promise);
        for (let i = 0; i < 128; i++) socket.send(`${i}`);
        expect(() => socket.send("overflow")).toThrow("queue limit");
        expect(native.mock.calls.filter(([cmd]) => cmd === "extension_bridge_send")).toHaveLength(1);
        pending.resolve(undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(native.mock.calls.filter(([cmd]) => cmd === "extension_bridge_send").map(([, args]) => args?.text))
            .toEqual(Array.from({ length: 128 }, (_, i) => `${i}`));
        socket.close();
    });

    it("never falls back to a browser socket on native failure", async () => {
        const browser = vi.fn();
        vi.stubGlobal("WebSocket", browser);
        try {
            const { native, socket, closed } = setup();
            native.mockRejectedValueOnce(new Error("native disabled"));
            await vi.advanceTimersByTimeAsync(0);
            expect(socket.readyState).toBe(3);
            expect(closed).toHaveBeenCalledTimes(1);
            expect(browser).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        } finally { vi.unstubAllGlobals(); }
    });
});
