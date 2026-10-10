import { afterEach, describe, expect, it, vi } from "vitest";
import { createBgraBmpBlob, encodeBgraAsBmp } from "../../src/services/liveRelay";

const readBlob = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
});

afterEach(() => vi.unstubAllGlobals());

describe("LiveRelay IPC pixel view to BMP Blob", () => {
    it.each([[1, 1], [2, 3], [17, 9]])("preserves exact BMP bytes for %ix%i", async (width, height) => {
        const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 256);
        const blob = createBgraBmpBlob(pixels, width, height);
        expect(blob.type).toBe("image/bmp");
        expect(blob.size).toBe(pixels.byteLength + 54);
        const actual = await readBlob(blob);
        expect(actual).toEqual(encodeBgraAsBmp(pixels, width, height));
        const header = new DataView(actual.buffer);
        expect(header.getUint32(2, true)).toBe(blob.size);
        expect(header.getInt32(22, true)).toBe(-height);
    });

    it("passes the original pixel view and only a 54-byte header to Blob", () => {
        const NativeBlob = Blob;
        const calls: BlobPart[][] = [];
        vi.stubGlobal("Blob", class extends NativeBlob {
            constructor(parts: BlobPart[], options?: BlobPropertyBag) {
                calls.push(parts);
                super(parts, options);
            }
        });
        const pixels = new Uint8Array(1920 * 1080 * 4);
        const blob = createBgraBmpBlob(pixels, 1920, 1080);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toHaveLength(2);
        expect((calls[0][0] as Uint8Array).byteLength).toBe(54);
        expect(calls[0][1]).toBe(pixels);
        expect(blob.size).toBe(pixels.byteLength + 54);
    });

    it("snapshots only the view, without leaking backing-buffer prefix or suffix", async () => {
        const backing = new Uint8Array([91, 92, 1, 2, 3, 255, 93, 94]);
        const pixels = backing.subarray(2, 6);
        const expected = encodeBgraAsBmp(pixels, 1, 1);
        const blob = createBgraBmpBlob(pixels, 1, 1);
        backing.fill(0);
        expect(await readBlob(blob)).toEqual(expected);
    });

    it.each([[0, 1], [1.5, 1], [1, -1], [Number.NaN, 1]])("rejects dimensions %s x %s", (width, height) => {
        expect(() => createBgraBmpBlob(new Uint8Array(4), width, height)).toThrow(/dimensions/);
    });

    it("rejects mismatched and unsafe pixel lengths", () => {
        expect(() => createBgraBmpBlob(new Uint8Array(3), 1, 1)).toThrow(/byte length/);
        expect(() => createBgraBmpBlob(new Uint8Array(4), Number.MAX_SAFE_INTEGER, 2)).toThrow(/byte length/);
    });
});
