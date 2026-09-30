// Resolves one selected unit's display source into a bounded encoded image.
export const MAX_UNIT_IMAGE_SOURCE_BYTES = 64 * 1024 * 1024;
const DATA_IMAGE_URL = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i;

export interface UnitImageSource {
    src?: string | null;
    filePath?: string | null;
}

export interface UnitImageSourceDependencies {
    readImageFromPath: (path: string) => Promise<string>;
    fetchImage?: typeof fetch;
}

export interface EncodedUnitImage {
    dataUrl: string;
    mime: string;
    dataBase64: string;
    byteLength: number;
}

const isFetchableImageSource = (value: string) => /^(?:https?:|asset:|blob:)/i.test(value);

export const parseUnitImageDataUrl = (
    dataUrl: string,
    maximumBytes = MAX_UNIT_IMAGE_SOURCE_BYTES,
): EncodedUnitImage => {
    const match = DATA_IMAGE_URL.exec(dataUrl);
    if (!match) throw new Error("Image source did not produce a supported Base64 data URL");
    const mime = match[1]!.toLowerCase();
    const dataBase64 = match[2]!;
    if (dataBase64.length % 4 !== 0) {
        throw new Error("Image source did not produce canonical Base64 data");
    }
    const padding = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
    const byteLength = Math.floor(dataBase64.length * 3 / 4) - padding;
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || byteLength <= 0 || byteLength > maximumBytes) {
        throw new Error(`Image source exceeds the ${maximumBytes}-byte limit`);
    }
    return { dataUrl, mime, dataBase64, byteLength };
};

const readBlobAsDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Image response did not produce a data URL"));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image response"));
    reader.readAsDataURL(blob);
});

const fetchImageAsDataUrl = async (
    src: string,
    fetchImage: typeof fetch,
    maximumBytes: number,
): Promise<string> => {
    const response = await fetchImage(src, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Image source request failed with HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
        throw new Error(`Image source exceeds the ${maximumBytes}-byte limit`);
    }
    const blob = await response.blob();
    if (blob.size > maximumBytes) throw new Error(`Image source exceeds the ${maximumBytes}-byte limit`);
    if (blob.type && !blob.type.toLowerCase().startsWith("image/")) {
        throw new Error("Image source response is not an image");
    }
    return readBlobAsDataUrl(blob);
};

/** Native file reads are preferred; URL fetching is the bounded fallback. */
export const resolveUnitImageDataUrl = async (
    source: UnitImageSource,
    dependencies: UnitImageSourceDependencies,
    maximumBytes = MAX_UNIT_IMAGE_SOURCE_BYTES,
): Promise<string> => {
    const src = source.src?.trim();
    if (!src) throw new Error("Selected unit has no image source");
    if (src.startsWith("data:")) return parseUnitImageDataUrl(src, maximumBytes).dataUrl;

    const filePath = source.filePath?.trim();
    if (filePath) {
        try {
            const dataUrl = await dependencies.readImageFromPath(filePath);
            return parseUnitImageDataUrl(dataUrl, maximumBytes).dataUrl;
        } catch (error) {
            if (!isFetchableImageSource(src)) throw error;
        }
    }
    if (!isFetchableImageSource(src)) {
        throw new Error("Selected image source cannot be converted");
    }
    const dataUrl = await fetchImageAsDataUrl(src, dependencies.fetchImage ?? fetch, maximumBytes);
    return parseUnitImageDataUrl(dataUrl, maximumBytes).dataUrl;
};
