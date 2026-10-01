/** Only the native Tauri application origin may receive probe UI interactions. */
export function hasTauriOrigin(value: string): boolean {
    try {
        const url = new URL(value);
        return url.origin === 'http://tauri.localhost' && !url.username && !url.password;
    } catch { return false; }
}

/** Runtime JSON is untyped: never interpolate an unchecked value into authority. */
export function loopbackHttpOrigin(value: unknown): string {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 65535) {
        throw new Error('Probe port must be an integer between 1 and 65535');
    }
    return `http://127.0.0.1:${Number(value)}`;
}

export function assertProbeRoute(route: string): void {
    // Concatenation stays path-only, including URL parsers that normalize backslashes.
    if (!route.startsWith('/') || route.startsWith('//') || /[\\\u0000-\u0020]/u.test(route)) {
        throw new Error('Probe route must be an absolute local path');
    }
}
