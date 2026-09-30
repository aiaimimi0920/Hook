import jsQR from "jsqr";

interface DecodeRequest { pixels: Uint8ClampedArray; width: number; height: number }
self.onmessage = (event: MessageEvent<DecodeRequest>) => {
    const { pixels, width, height } = event.data;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
        || width > 1536 || height > 1536 || pixels.length !== width * height * 4) {
        self.postMessage({ error: "projection_invalid_image" }); return;
    }
    try {
        const code = jsQR(pixels, width, height);
        self.postMessage(code ? { text: code.data } : { error: "projection_qr_not_found" });
    } catch { self.postMessage({ error: "projection_invalid_image" }); }
};
