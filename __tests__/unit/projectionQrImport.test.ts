import { afterEach, expect, it, vi } from "vitest";
import { decodeProjectionQrPixels, importProjectionQr, validateProjectionQrPng } from "../../src/services/projectionQrImport";
import { projectionEnvelope } from "../fixtures/qrProjection";

const png = (width: number, height: number) => {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12);
    const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height);
    return bytes;
};
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("rejects malformed and excessive image dimensions before browser decoding", async () => {
    expect(() => validateProjectionQrPng(png(512, 512))).not.toThrow();
    expect(() => validateProjectionQrPng(png(4097, 20))).toThrow("projection_image_budget");
    expect(() => validateProjectionQrPng(png(0, 20))).toThrow();
    expect(() => validateProjectionQrPng(new Uint8Array(33))).toThrow();
    await expect(importProjectionQr(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "huge.png"), new AbortController().signal)).rejects.toThrow("projection_image_budget");
});

it.each(["abort", "timeout", "response", "error"])("terminates the QR worker on %s", async (mode) => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    let worker!: { onmessage?: (event: MessageEvent) => void; onerror?: () => void };
    vi.stubGlobal("Worker", class {
        constructor() { worker = this; }
        onmessage?: (event: MessageEvent) => void;
        onerror?: () => void;
        postMessage() {}
        terminate = terminate;
    });
    const abort = new AbortController();
    const pending = decodeProjectionQrPixels({ data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData, abort.signal);
    const observed = pending.then((text) => text, (reason: Error) => reason.message);
    if (mode === "abort") abort.abort();
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(10_001);
    if (mode === "response") worker.onmessage?.(new MessageEvent("message", { data: { text: JSON.stringify(projectionEnvelope()) } }));
    if (mode === "error") worker.onerror?.();
    expect(await observed).toBe(mode === "response" ? JSON.stringify(projectionEnvelope()) : mode === "abort" ? "projection_import_cancelled" : mode === "timeout" ? "projection_qr_timeout" : "projection_invalid_image");
    expect(terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
