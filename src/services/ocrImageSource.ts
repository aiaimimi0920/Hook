// Resolves Hook's display image sources into bounded data URLs accepted by Loom OCR.

const MAX_OCR_SOURCE_BYTES = 64 * 1024 * 1024;
const DATA_URL_PREFIX = /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i;

export interface OcrImageSource {
    src?: string | null;
    filePath?: string | null;
}

export interface OcrImageSourceDependencies {
    readImageFromPath: (path: string) => Promise<string>;
    fetchImage?: typeof fetch;
}

const isDataImageUrl = (value: string) => DATA_URL_PREFIX.test(value);

const isFetchableImageSource = (value: string) =>
    /^(?:https?:|asset:|blob:)/i.test(value);

const readBlobAsDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string" || !isDataImageUrl(result)) {
            reject(new Error("Image response did not produce a data URL"));
            return;
        }
        resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image response"));
    reader.readAsDataURL(blob);
});

const fetchImageAsDataUrl = async (
    src: string,
    fetchImage: typeof fetch,
): Promise<string> => {
    const response = await fetchImage(src, { credentials: "same-origin" });
    if (!response.ok) {
        throw new Error(`Image source request failed with HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > MAX_OCR_SOURCE_BYTES) {
        throw new Error("Image source is too large for OCR");
    }

    const blob = await response.blob();
    if (blob.size > MAX_OCR_SOURCE_BYTES) {
        throw new Error("Image source is too large for OCR");
    }
    if (blob.type && !blob.type.toLowerCase().startsWith("image/")) {
        throw new Error("Image source response is not an image");
    }
    return readBlobAsDataUrl(blob);
};

/**
 * Captures are intentionally file-backed, so `unit.data.src` is commonly an
 * asset URL rather than the Base64 payload required by the Loom protocol.
 * Prefer the validated native file reader and only fetch a URL when no path is
 * available. The size guard keeps OCR conversion from becoming an unbounded
 * WebView memory allocation.
 */
export const resolveOcrImageDataUrl = async (
    source: OcrImageSource,
    dependencies: OcrImageSourceDependencies,
): Promise<string> => {
    const src = source.src?.trim();
    if (!src) throw new Error("Selected unit has no image source");
    if (isDataImageUrl(src)) return src;

    const filePath = source.filePath?.trim();
    if (filePath) {
        try {
            const dataUrl = await dependencies.readImageFromPath(filePath);
            if (isDataImageUrl(dataUrl)) return dataUrl;
            throw new Error("Native image reader returned an invalid data URL");
        } catch (error) {
            if (!isFetchableImageSource(src)) throw error;
        }
    }

    if (!isFetchableImageSource(src)) {
        throw new Error("Selected image source cannot be converted for OCR");
    }
    const fetchImage = dependencies.fetchImage ?? fetch;
    return fetchImageAsDataUrl(src, fetchImage);
};
