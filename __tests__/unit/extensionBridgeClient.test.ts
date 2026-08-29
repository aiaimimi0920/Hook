import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExtensionBridgeClient } from "../../src/services/extensionBridgeClient";
import { parseExtensionResult } from "../../src/services/extensionBridgeProtocol";
import { extensionRegistry } from "../../src/services/extensionRegistry";

class FakeWebSocket {
    readyState = 0;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    send(value: string): void {
        this.sent.push(value);
    }

    close(): void {
        this.readyState = 3;
        this.onclose?.();
    }

    open(): void {
        this.readyState = 1;
        this.onopen?.();
    }

    receive(value: unknown): void {
        this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
    }
}

const snapshot = () => JSON.parse(readFileSync(resolve(
    process.cwd(),
    "__tests__/fixtures/capability/extension-snapshot.json",
), "utf8"));

afterEach(() => {
    vi.useRealTimers();
    const active = extensionRegistry.snapshot();
    if (active) extensionRegistry.beginSession("test-reset");
});

describe("ExtensionBridgeClient", () => {
    it("negotiates on the same Hook socket, invokes a command, and clears on disconnect", async () => {
        const socket = new FakeWebSocket();
        const client = new ExtensionBridgeClient(() => socket as unknown as WebSocket);
        const stop = client.start();
        socket.open();
        expect(JSON.parse(socket.sent[0]!).method).toBe("loom.hook.handshake");

        socket.receive({ sessionId: "hook:test", protocolVersion: "loom.hook.v1" });
        const handshake = JSON.parse(socket.sent[1]!);
        expect(handshake.params.hookSessionId).toBe("hook:test");
        socket.receive({
            protocol: "loom.extension.v1",
            apiVersion: "1.0",
            requestId: handshake.params.requestId,
            status: "succeeded",
            data: {
                sessionId: "extension:test",
                features: ["contribution.snapshot", "command.invoke"],
                snapshot: snapshot(),
            },
        });
        expect(extensionRegistry.snapshot()?.generation).toBe(1);

        const invocation = client.invoke({
            pluginId: "publisher.example/text-tools",
            commandId: "publisher.example/text-tools.transform",
            target: { unitId: "unit-1", revision: 2 },
            userGestureToken: "hook-gesture:1234567890",
        });
        const invokeRequest = JSON.parse(socket.sent[2]!);
        expect(invokeRequest.params.invocation.snapshotGeneration).toBe(1);
        socket.receive({
            protocol: "loom.extension.v1",
            apiVersion: "1.0",
            requestId: invokeRequest.params.invocation.requestId,
            status: "succeeded",
            data: {
                protocol: "loom.extension.v1",
                apiVersion: "1.0",
                requestId: invokeRequest.params.invocation.requestId,
                status: "succeeded",
                output: { ok: true },
                effects: [],
            },
        });
        await expect(invocation).resolves.toMatchObject({ status: "succeeded", output: { ok: true } });

        stop();
        expect(extensionRegistry.snapshot()).toBeNull();
    });

    it("ignores a delayed close event from a replaced socket", () => {
        vi.useFakeTimers();
        const sockets = [new FakeWebSocket(), new FakeWebSocket()];
        let socketIndex = 0;
        const client = new ExtensionBridgeClient(() => sockets[socketIndex++] as unknown as WebSocket);
        const stop = client.start();
        sockets[0]!.open();
        sockets[0]!.close();
        vi.advanceTimersByTime(1_000);

        const current = sockets[1]!;
        current.open();
        current.receive({ sessionId: "hook:replacement", protocolVersion: "loom.hook.v1" });
        const handshake = JSON.parse(current.sent[1]!);
        current.receive({
            protocol: "loom.extension.v1",
            apiVersion: "1.0",
            requestId: handshake.params.requestId,
            status: "succeeded",
            data: {
                sessionId: "extension:replacement",
                features: ["contribution.snapshot", "command.invoke"],
                snapshot: snapshot(),
            },
        });

        sockets[0]!.onclose?.();
        expect(extensionRegistry.snapshot()?.generation).toBe(1);
        stop();
    });

    it("rejects effect types outside the negotiated protocol", () => {
        expect(() => parseExtensionResult({
            protocol: "loom.extension.v1",
            apiVersion: "1.0",
            requestId: "result-1",
            status: "succeeded",
            output: {},
            effects: [{ type: "process.launch", payload: {} }],
        })).toThrow("unsupported");
    });
});
