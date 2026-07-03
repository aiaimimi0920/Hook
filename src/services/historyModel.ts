// Pure helpers for the color + screenshot history feature.
//
// Both histories are bounded, most-recent-first lists that the floating
// History panel renders and that are persisted to disk via the Rust
// save_history/load_history commands. Keeping the list logic pure (no store,
// no IO) makes the dedup/cap/normalize rules straightforward to unit test.

export interface ColorHistoryEntry {
    hex: string;
    rgb: { r: number; g: number; b: number };
    at: number;
}

export interface ScreenshotHistoryEntry {
    id: string;
    thumbnail: string; // data URL (downscaled preview)
    width: number;
    height: number;
    at: number;
}

export interface HistoryState {
    colors: ColorHistoryEntry[];
    screenshots: ScreenshotHistoryEntry[];
}

export const MAX_COLOR_HISTORY = 24;
export const MAX_SCREENSHOT_HISTORY = 24;

export const createEmptyHistoryState = (): HistoryState => ({
    colors: [],
    screenshots: [],
});

const normalizeHex = (hex: string): string | null => {
    const trimmed = hex.trim().toLowerCase();
    const match = /^#?([0-9a-f]{6})$/.exec(trimmed);
    if (!match) return null;
    return `#${match[1]}`;
};

/**
 * Prepend a color to the history, de-duplicating by hex (an existing identical
 * color is moved to the front, refreshing its timestamp) and capping length.
 */
export const addColorToHistory = (
    history: ColorHistoryEntry[],
    color: { hex: string; rgb: { r: number; g: number; b: number } },
    at: number,
    limit = MAX_COLOR_HISTORY,
): ColorHistoryEntry[] => {
    const hex = normalizeHex(color.hex);
    if (!hex) return history;
    const entry: ColorHistoryEntry = { hex, rgb: color.rgb, at };
    const withoutDuplicate = history.filter((existing) => existing.hex !== hex);
    return [entry, ...withoutDuplicate].slice(0, Math.max(0, limit));
};

/**
 * Prepend a screenshot to the history, capping length. Screenshots are not
 * de-duplicated (two captures of the same region are distinct entries) but the
 * id is used so the panel can key/remove individual entries.
 */
export const addScreenshotToHistory = (
    history: ScreenshotHistoryEntry[],
    entry: ScreenshotHistoryEntry,
    limit = MAX_SCREENSHOT_HISTORY,
): ScreenshotHistoryEntry[] => {
    const withoutDuplicate = history.filter((existing) => existing.id !== entry.id);
    return [entry, ...withoutDuplicate].slice(0, Math.max(0, limit));
};

export const removeScreenshotFromHistory = (
    history: ScreenshotHistoryEntry[],
    id: string,
): ScreenshotHistoryEntry[] => history.filter((entry) => entry.id !== id);

export const THUMBNAIL_MAX_EDGE = 240;

/**
 * Compute thumbnail dimensions that fit within THUMBNAIL_MAX_EDGE while
 * preserving aspect ratio. Never upscales. Pure so it can be unit tested
 * without a canvas.
 */
export const computeThumbnailSize = (
    width: number,
    height: number,
    maxEdge = THUMBNAIL_MAX_EDGE,
): { width: number; height: number } => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { width: 0, height: 0 };
    }
    const longest = Math.max(width, height);
    if (longest <= maxEdge) {
        return { width: Math.round(width), height: Math.round(height) };
    }
    const scale = maxEdge / longest;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
};

/**
 * Downscale a data URL image to a thumbnail data URL via an offscreen canvas.
 * Returns the original src if the environment has no canvas (e.g. SSR) or the
 * image cannot be decoded, so callers always get a usable value.
 */
export const createThumbnailDataUrl = async (
    src: string,
    maxEdge = THUMBNAIL_MAX_EDGE,
): Promise<{ thumbnail: string; width: number; height: number }> => {
    if (typeof document === "undefined" || typeof Image === "undefined") {
        return { thumbnail: src, width: 0, height: 0 };
    }
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("thumbnail decode failed"));
            element.src = src;
        });
        const size = computeThumbnailSize(image.width, image.height, maxEdge);
        if (size.width <= 0 || size.height <= 0) {
            return { thumbnail: src, width: image.width, height: image.height };
        }
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d");
        if (!context) {
            return { thumbnail: src, width: image.width, height: image.height };
        }
        context.drawImage(image, 0, 0, size.width, size.height);
        return {
            thumbnail: canvas.toDataURL("image/png"),
            width: image.width,
            height: image.height,
        };
    } catch {
        return { thumbnail: src, width: 0, height: 0 };
    }
};

/**
 * Coerce arbitrary parsed JSON (e.g. from disk) into a valid HistoryState,
 * dropping malformed entries. Defensive against hand-edited / corrupt files.
 */
export const sanitizeHistoryState = (raw: unknown): HistoryState => {
    const state = createEmptyHistoryState();
    if (!raw || typeof raw !== "object") return state;
    const record = raw as Record<string, unknown>;

    if (Array.isArray(record.colors)) {
        for (const item of record.colors) {
            if (!item || typeof item !== "object") continue;
            const candidate = item as Record<string, unknown>;
            const hex = typeof candidate.hex === "string" ? normalizeHex(candidate.hex) : null;
            const rgb = candidate.rgb as Record<string, unknown> | undefined;
            if (!hex || !rgb) continue;
            const r = Number(rgb.r);
            const g = Number(rgb.g);
            const b = Number(rgb.b);
            if (![r, g, b].every((channel) => Number.isFinite(channel))) continue;
            state.colors.push({
                hex,
                rgb: { r, g, b },
                at: Number.isFinite(Number(candidate.at)) ? Number(candidate.at) : 0,
            });
        }
        state.colors = state.colors.slice(0, MAX_COLOR_HISTORY);
    }

    if (Array.isArray(record.screenshots)) {
        for (const item of record.screenshots) {
            if (!item || typeof item !== "object") continue;
            const candidate = item as Record<string, unknown>;
            const id = typeof candidate.id === "string" ? candidate.id : null;
            const thumbnail = typeof candidate.thumbnail === "string" ? candidate.thumbnail : null;
            if (!id || !thumbnail || !thumbnail.startsWith("data:image")) continue;
            state.screenshots.push({
                id,
                thumbnail,
                width: Number.isFinite(Number(candidate.width)) ? Number(candidate.width) : 0,
                height: Number.isFinite(Number(candidate.height)) ? Number(candidate.height) : 0,
                at: Number.isFinite(Number(candidate.at)) ? Number(candidate.at) : 0,
            });
        }
        state.screenshots = state.screenshots.slice(0, MAX_SCREENSHOT_HISTORY);
    }

    return state;
};
