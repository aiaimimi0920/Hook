import { afterEach, describe, expect, it } from "vitest";

import { encodeBgraAsBmp } from "../../src/services/liveRelay";
import type { LiveRelaySnapshot } from "../../src/services/liveRelay";
import { liveRelayActions, liveRelayViews } from "../../src/store/liveRelayStore";

const snapshot = (relayId: string): LiveRelaySnapshot => ({
    relayId,
    liveSessionId: `live:${relayId}`,
    role: "viewer",
    connectionState: "connected",
    epoch: 1,
    lastFrameId: 0,
    receivedFrames: 0,
    reconnectCount: 0,
    overwrittenFrames: 0,
    controllerOwned: false,
    remoteControlActive: false,
    lastInputSequence: 0,
    mediaTransport: "websocket_binary",
    networkScope: "loopback_http",
    roundTripLatencyMs: 24,
    latencyState: "low",
    observationCapabilities: ["uia_tree", "range_value"],
    observationState: "stable",
    observations: [],
    triggers: [],
    triggerAudits: [],
});

afterEach(() => liveRelayActions.clear());

describe("live relay rendering and per-view state", () => {
    it("wraps top-down raw BGRA pixels in a bounded 32-bit BMP", () => {
        const bgra = new Uint8Array([3, 2, 1, 255, 6, 5, 4, 255]);
        const bmp = encodeBgraAsBmp(bgra, 2, 1);
        const header = new DataView(bmp.buffer);

        expect([...bmp.slice(0, 2)]).toEqual([0x42, 0x4d]);
        expect(header.getUint32(2, true)).toBe(62);
        expect(header.getUint32(10, true)).toBe(54);
        expect(header.getInt32(18, true)).toBe(2);
        expect(header.getInt32(22, true)).toBe(-1);
        expect(header.getUint16(28, true)).toBe(32);
        expect([...bmp.slice(54)]).toEqual([...bgra]);
        expect(() => encodeBgraAsBmp(bgra, 3, 1)).toThrow(/byte length/);
    });

    it("keeps geometry, pinning, frames, and control errors isolated by relay id", () => {
        liveRelayActions.add(snapshot("viewer-a"), "A", { x: 10, y: 20, width: 320, height: 200 });
        liveRelayActions.add(snapshot("viewer-b"), "B", { x: 40, y: 50, width: 360, height: 240 });

        liveRelayActions.updateGeometry("viewer-a", { x: 90, y: 80, width: 420, height: 260 });
        liveRelayActions.setPinned("viewer-a", true);
        liveRelayActions.setError("viewer-b", "controller conflict");

        expect(liveRelayViews[0]).toMatchObject({
            relayId: "viewer-a",
            x: 90,
            y: 80,
            width: 420,
            height: 260,
            pinned: true,
        });
        expect(liveRelayViews[0].controlError).toBeUndefined();
        expect(liveRelayViews[1]).toMatchObject({
            relayId: "viewer-b",
            x: 40,
            y: 50,
            width: 360,
            height: 240,
            pinned: false,
            controlError: "controller conflict",
        });
    });
});
