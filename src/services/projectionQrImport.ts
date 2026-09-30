import { parseProjectionInvitation } from "./qrProjectionProtocol";

export function validateProjectionQrPng(bytes: Uint8Array): void {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || bytes.length > 4 * 1024 * 1024 || signature.some((value, index) => bytes[index] !== value)
        || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) throw new Error("projection_invalid_image");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width > 4096 || height > 4096 || width * height > 16_777_216) throw new Error("projection_image_budget");
}

export function decodeProjectionQrPixels(pixels: ImageData, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new Error("projection_import_cancelled")); return; }
        const worker = new Worker(new URL("./projectionQrDecode.worker.ts", import.meta.url), { type: "module" });
        const finish = (text?: string, error?: string) => {
            clearTimeout(timer); signal.removeEventListener("abort", abort); worker.terminate();
            if (error) reject(new Error(error)); else resolve(text!);
        };
        const abort = () => finish(undefined, "projection_import_cancelled");
        const timer = setTimeout(() => finish(undefined, "projection_qr_timeout"), 10_000);
        signal.addEventListener("abort", abort, { once: true });
        worker.onerror = () => finish(undefined, "projection_invalid_image");
        worker.onmessage = (event: MessageEvent<{ text?: string; error?: string }>) => {
            try {
                if (!event.data.text) throw new Error(event.data.error ?? "projection_qr_not_found");
                finish(JSON.stringify(parseProjectionInvitation(event.data.text)));
            } catch (reason) { finish(undefined, reason instanceof Error ? reason.message : "projection_invalid_invitation"); }
        };
        try { worker.postMessage({ pixels: pixels.data, width: pixels.width, height: pixels.height }, [pixels.data.buffer]); }
        catch { finish(undefined, "projection_invalid_image"); }
    });
}

/** Decode bounded local PNGs off the UI thread; no OCR service or remote fetch. */
export async function importProjectionQr(file: File, signal: AbortSignal): Promise<string> {
    if (file.size > 4 * 1024 * 1024) throw new Error("projection_image_budget");
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateProjectionQrPng(bytes);
    if (signal.aborted) throw new Error("projection_import_cancelled");
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    try {
        if (signal.aborted) throw new Error("projection_import_cancelled");
        const scale = Math.min(1, 1536 / bitmap.width, 1536 / bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("projection_invalid_image");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await decodeProjectionQrPixels(context.getImageData(0, 0, canvas.width, canvas.height), signal);
    } finally { bitmap.close(); }
}
