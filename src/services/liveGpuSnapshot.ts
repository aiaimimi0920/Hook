/** Explicit lossless snapshots, independent of the continuous JPEG frame queue. */
import { isTauriRuntimeAvailable, safeInvoke } from "./apiTransport";

export interface LiveGpuSnapshot {
    bytes: Uint8Array<ArrayBuffer>;
    capturedAtMs: number;
}

export function decodeLiveGpuSnapshot(payload: ArrayBuffer | Uint8Array<ArrayBuffer>): LiveGpuSnapshot | undefined {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (bytes.byteLength === 0) return undefined;
    if (bytes.byteLength < 16 || bytes.byteLength > 64 * 1024 * 1024) {
        throw new Error("Invalid GPU snapshot payload length");
    }
    const capturedAtMs = Number(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true));
    if (!Number.isSafeInteger(capturedAtMs) || capturedAtMs <= 0
        || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[8 + index] === value)) {
        throw new Error("Invalid GPU snapshot header");
    }
    return { bytes: bytes.slice(8), capturedAtMs };
}

export async function readLiveGpuSnapshot(sessionId: string): Promise<LiveGpuSnapshot | undefined> {
    if (!isTauriRuntimeAvailable()) return undefined;
    return decodeLiveGpuSnapshot(await safeInvoke<ArrayBuffer | Uint8Array<ArrayBuffer>>(
        "read_live_gpu_snapshot", { sessionId },
    ));
}
