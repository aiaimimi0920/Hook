/** Strict NLWM boundary. Validate compressed dimensions/chunks before any browser decode. */
export type WallMediaFormat = 'raw_bgra' | 'png';
export interface WallMediaInfo {
    epoch: bigint; frameId: bigint; captureAtMs: number; encodeAtMs: number;
    receivedAtMs: number; sentAtMs: number; width: number; height: number;
    droppedFrames: number; byteLength: number; format: WallMediaFormat;
}
export function readWallMedia(buffer: ArrayBuffer): WallMediaInfo {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer);
    if (bytes.length < 80 || bytes.length > 16 * 1024 * 1024 + 80
        || [78, 76, 87, 77, 1, 1, 0, 80].some((value, index) => bytes[index] !== value)
        || bytes[56] !== 1 || ![1, 2].includes(bytes[57]) || bytes.subarray(58, 64).some((value) => value !== 0)
        || view.getBigUint64(8) === 0n || view.getBigUint64(16) === 0n || view.getUint32(52) !== bytes.length - 80) {
        throw new Error('wall_live_frame_invalid');
    }
    const times = [24, 32, 64, 72].map((at) => view.getBigUint64(at));
    if (times.some((value) => value > BigInt(Number.MAX_SAFE_INTEGER)) || times[2] === 0n || times[3] < times[2]) {
        throw new Error('wall_live_frame_time_invalid');
    }
    const width = view.getUint32(40), height = view.getUint32(44), format = bytes[57] === 1 ? 'raw_bgra' : 'png';
    if (!width || !height || width > 16384 || height > 16384
        || (format === 'raw_bgra' ? width * height * 4 !== bytes.length - 80
            : width > 1280 || height > 720 || bytes.length - 80 > 4 * 1024 * 1024 || !validPng(bytes.subarray(80), width, height))) {
        throw new Error('wall_live_dimensions_invalid');
    }
    return { epoch: view.getBigUint64(8), frameId: view.getBigUint64(16), width, height, format,
        captureAtMs: Number(times[0]), encodeAtMs: Number(times[1]), receivedAtMs: Number(times[2]), sentAtMs: Number(times[3]),
        droppedFrames: view.getUint32(48), byteLength: bytes.length };
}

function validPng(bytes: Uint8Array, width: number, height: number): boolean {
    if (bytes.length < 57 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, i) => bytes[i] !== value)) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 || view.getUint32(16) !== width
        || view.getUint32(20) !== height || [8, 2, 0, 0, 0].some((value, i) => bytes[24 + i] !== value)) return false;
    let at = 33, data = false;
    while (at + 12 <= bytes.length) {
        const length = view.getUint32(at), kind = view.getUint32(at + 4);
        if (length > bytes.length - at - 12) return false;
        if (kind === 0x49444154) data = true;
        else if (kind === 0x49454e44) return data && length === 0 && at + 12 === bytes.length;
        else return false;
        at += length + 12;
    }
    return false;
}
