import { describe, expect, it } from "vitest";
import { decodeLiveGpuSnapshot } from "../../src/services/liveGpuSnapshot";

const packet = (timestamp = 1234n) => {
    const bytes = new Uint8Array(20);
    new DataView(bytes.buffer).setBigUint64(0, timestamp, true);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4], 8);
    return bytes;
};

describe("GPU snapshot binary boundary", () => {
    it("uses an empty response for disabled or unavailable native snapshots", () => {
        expect(decodeLiveGpuSnapshot(new ArrayBuffer(0))).toBeUndefined();
    });
    it("reads the lossless payload and timestamp from a binary response", () => {
        const bytes = packet();
        expect(decodeLiveGpuSnapshot(bytes.buffer)).toEqual({ bytes: bytes.slice(8), capturedAtMs: 1234 });
    });
    it("honors typed-array offsets and owns the decoded bytes", () => {
        const bytes = new Uint8Array(24);
        bytes.set(packet(), 4);
        const snapshot = decodeLiveGpuSnapshot(bytes.subarray(4))!;
        bytes.fill(0);
        expect(snapshot.capturedAtMs).toBe(1234);
        expect(snapshot.bytes[0]).toBe(137);
    });
    it("rejects truncated and non-PNG payloads", () => {
        expect(() => decodeLiveGpuSnapshot(new Uint8Array(9))).toThrow(/length/);
        const bytes = packet(); bytes[8] = 0;
        expect(() => decodeLiveGpuSnapshot(bytes)).toThrow(/header/);
    });
    it("rejects zero and unsafe timestamps", () => {
        expect(() => decodeLiveGpuSnapshot(packet(0n))).toThrow(/header/);
        expect(() => decodeLiveGpuSnapshot(packet(2n ** 63n))).toThrow(/header/);
    });
});
