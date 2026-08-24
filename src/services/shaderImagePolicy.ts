import { convertFileSrc } from "@tauri-apps/api/core";

import { isTauriRuntimeAvailable } from "./api";

export const MAX_SHADER_TEXTURE_DIMENSION = 8192;
export const MAX_SHADER_TEXTURE_PIXELS = 32 * 1024 * 1024;

/** Bounds texture and export allocations while retaining the supported 4K path. */
export const isShaderImageSizeWithinBudget = (
    width: number,
    height: number,
    maxDimension = MAX_SHADER_TEXTURE_DIMENSION,
) =>
    Number.isFinite(width)
    && Number.isFinite(height)
    && width > 0
    && height > 0
    && width <= maxDimension
    && height <= maxDimension
    && width * height <= MAX_SHADER_TEXTURE_PIXELS;

/** Allows raster/browser image sources and converts desktop file paths for image loading. */
export const resolveShaderBrowserImageUrl = (source: string) => {
    const src = source.trim();
    if (!src) return "";
    if (/^data:image\/(?:png|jpe?g|webp|gif|bmp|avif)(?:;|,)/i.test(src)) return src;
    if (/^(?:blob:|asset:|https?:\/\/)/i.test(src)) {
        return src;
    }
    if (!isTauriRuntimeAvailable()) {
        const hasExplicitScheme = /^[a-z][a-z\d+.-]*:/i.test(src);
        return !hasExplicitScheme && !src.startsWith("//") ? src : "";
    }
    return convertFileSrc(src);
};
