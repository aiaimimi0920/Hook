import { normalizeImageSourceForDisplay } from "./imageSource";

const MAX_TEXTURE_PIXELS = 16_777_216;
const MAX_SHARED_PIXELS = 33_554_432;
const MAX_TEXTURES = 32;
const LOAD_TIMEOUT_MS = 10_000;

interface BlurTextureEntry {
    users: number;
    pixels: number;
    promise: Promise<string | null>;
    cancel: () => void;
    url: string | null;
}

// Only mounted overlays retain textures. Identical committed/draft brushes share
// the same raster; the last owner releases both pending work and the blob URL.
const textures = new Map<string, BlurTextureEntry>();
let reservedPixels = 0;

export const acquireStickerBlurTexture = (
    source: string,
    width: number,
    height: number,
    radius: number,
): { ready: Promise<string | null>; release: () => void } => {
    const w = Math.ceil(width);
    const h = Math.ceil(height);
    const pixels = w * h;
    const unavailable = () => ({ ready: Promise.resolve(null), release: () => undefined });
    if (!source || ![width, height, radius].every(Number.isFinite) ||
        width <= 0 || height <= 0 || radius <= 0 || radius > 256 ||
        w > 8192 || h > 8192 || pixels > MAX_TEXTURE_PIXELS) return unavailable();

    const key = JSON.stringify([source, width, height, radius]);
    let entry = textures.get(key);
    if (!entry) {
        if (textures.size >= MAX_TEXTURES || reservedPixels + pixels > MAX_SHARED_PIXELS) {
            return unavailable();
        }
        entry = { users: 0, pixels, promise: Promise.resolve(null), cancel: () => undefined, url: null };
        textures.set(key, entry);
        reservedPixels += pixels;
        const current = entry;
        current.promise = new Promise((resolve) => {
            const image = new Image();
            let canvas: HTMLCanvasElement | null = null;
            let settled = false;
            const finish = (url: string | null) => {
                if (settled) {
                    if (url) URL.revokeObjectURL(url);
                    return;
                }
                settled = true;
                clearTimeout(timer);
                image.onload = null;
                image.onerror = null;
                image.src = "";
                if (canvas) { canvas.width = 0; canvas.height = 0; canvas = null; }
                current.url = url;
                resolve(url);
            };
            current.cancel = () => finish(null);
            const timer = setTimeout(() => finish(null), LOAD_TIMEOUT_MS);
            image.onerror = () => finish(null);
            image.onload = () => {
                try {
                    if (!image.naturalWidth || !image.naturalHeight) return finish(null);
                    canvas = document.createElement("canvas");
                    canvas.width = w;
                    canvas.height = h;
                    const context = canvas.getContext("2d");
                    if (!context || !("filter" in context)) return finish(null);
                    // Match the SVG's xMidYMid meet geometry, including transparent
                    // margins. Rasterization happens once, never on a pointer move.
                    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
                    const drawnW = image.naturalWidth * scale;
                    const drawnH = image.naturalHeight * scale;
                    context.scale(w / width, h / height);
                    context.filter = `blur(${radius}px)`;
                    context.drawImage(image, (width - drawnW) / 2, (height - drawnH) / 2, drawnW, drawnH);
                    canvas.toBlob((blob) => {
                        if (settled) return;
                        try { finish(blob ? URL.createObjectURL(blob) : null); }
                        catch { finish(null); }
                    }, "image/png");
                } catch {
                    // CORS/unsupported canvas must retain the existing SVG blur,
                    // never silently replace it with an unblurred source image.
                    finish(null);
                }
            };
            try {
                const resolved = normalizeImageSourceForDisplay(source) || source;
                if (!resolved.startsWith("data:") && !resolved.startsWith("blob:")) {
                    image.crossOrigin = "anonymous";
                }
                image.src = resolved;
            } catch {
                finish(null);
            }
        });
    }
    const retained = entry;
    retained.users += 1;
    let released = false;
    return {
        ready: retained.promise,
        release: () => {
            if (released) return;
            released = true;
            retained.users -= 1;
            if (retained.users > 0) return;
            textures.delete(key);
            reservedPixels -= retained.pixels;
            retained.cancel();
            if (retained.url) URL.revokeObjectURL(retained.url);
            retained.url = null;
        },
    };
};
