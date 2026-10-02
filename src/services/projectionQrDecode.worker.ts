import jsQR from "jsqr";

interface DecodeRequest { pixels: Uint8ClampedArray; width: number; height: number }
function isDecodeRequest(data: unknown): data is DecodeRequest {
    if (typeof data !== "object" || data === null) return false;
    const { pixels, width, height } = data as Partial<DecodeRequest>;
    return pixels instanceof Uint8ClampedArray
        && typeof width === "number" && Number.isSafeInteger(width) && width >= 1 && width <= 1536
        && typeof height === "number" && Number.isSafeInteger(height) && height >= 1 && height <= 1536
        && pixels.length === width * height * 4;
}

// A dedicated Worker receives only its creator's private-channel messages, not
// Window.postMessage traffic. Its messages have no page origin to authenticate;
// validate the structured-cloned payload before passing pixels to the decoder.
self.onmessage = (event: MessageEvent<unknown>) => {
    if (!isDecodeRequest(event.data)) {
        self.postMessage({ error: "projection_invalid_image" }); return;
    }
    const { pixels, width, height } = event.data;
    try {
        const code = jsQR(pixels, width, height);
        self.postMessage(code ? { text: code.data } : { error: "projection_qr_not_found" });
    } catch { self.postMessage({ error: "projection_invalid_image" }); }
};
