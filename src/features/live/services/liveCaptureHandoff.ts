/** Controller-owned transient frames; presentation changes never persist graph data. */
const presenters = new Map<string, { present: () => Promise<void>; pending?: Promise<void> }>();

export function registerLiveCaptureHandoff(id: string, present: () => Promise<void>): void {
    presenters.set(id, { present });
}

export function unregisterLiveCaptureHandoff(id: string): void {
    presenters.delete(id);
}

export function refreshLiveCaptureHandoff(id: string): Promise<void> {
    const entry = presenters.get(id);
    if (!entry) return Promise.resolve();
    entry.pending ??= Promise.resolve().then(entry.present).finally(() => { entry.pending = undefined; });
    return entry.pending;
}

/** Let the decoded fallback paint before removing its native cover; hidden tabs never hang. */
export function waitForLiveFallbackPaint(): Promise<void> {
    if (document.visibilityState === "hidden") return Promise.resolve();
    return new Promise((resolve) => {
        let first = 0;
        let second = 0;
        const finish = () => {
            clearTimeout(timeout);
            cancelAnimationFrame(first);
            cancelAnimationFrame(second);
            resolve();
        };
        const timeout = setTimeout(finish, 200);
        first = requestAnimationFrame(() => { second = requestAnimationFrame(finish); });
    });
}
