const MAX_EXTERNAL_URL_BYTES = 8 * 1024;
const hasUnsafeUrlCharacter = (value: string): boolean => Array.from(value).some((character) =>
    character === "\\" || character.charCodeAt(0) <= 0x20);

export const normalizeExternalHttpsUrl = (value: unknown): string => {
    if (typeof value !== "string"
        || value.length === 0
        || new TextEncoder().encode(value).byteLength > MAX_EXTERNAL_URL_BYTES
        || hasUnsafeUrlCharacter(value)) {
        throw new Error("extension external URL must be a bounded HTTPS URL");
    }
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error("extension external URL is invalid");
    }
    if (parsed.protocol !== "https:"
        || !parsed.hostname
        || parsed.username.length > 0
        || parsed.password.length > 0) {
        throw new Error("extension external URL must use HTTPS without credentials");
    }
    return parsed.href;
};

export const isDirectSurfaceClick = (input: unknown, commandId: string): boolean => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return false;
    const surfaceEvent = (input as Record<string, unknown>).surfaceEvent;
    if (!surfaceEvent || typeof surfaceEvent !== "object" || Array.isArray(surfaceEvent)) return false;
    const event = surfaceEvent as Record<string, unknown>;
    return event.event === "click" && event.action === commandId;
};
