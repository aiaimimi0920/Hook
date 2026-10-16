import { convertFileSrc } from "@tauri-apps/api/core";

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\]+\\[^\\]+/;

export const isLikelyLocalFilePath = (src: string | null | undefined) => {
    if (!src) return false;
    return WINDOWS_DRIVE_PATH_PATTERN.test(src) || WINDOWS_UNC_PATH_PATTERN.test(src);
};

export const normalizeImageSourceForDisplay = (
    src: string | null | undefined,
    fileSrcConverter: (path: string) => string = convertFileSrc,
) => {
    if (!src) return src ?? undefined;
    if (
        src.startsWith("data:") ||
        src.startsWith("blob:") ||
        src.startsWith("asset:") ||
        src.startsWith("http:") ||
        src.startsWith("https:")
    ) {
        return src;
    }
    if (isLikelyLocalFilePath(src)) {
        return fileSrcConverter(src);
    }
    if (URL_SCHEME_PATTERN.test(src)) {
        return src;
    }
    return src;
};
