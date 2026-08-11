import { createStore, reconcile } from "solid-js/store";

const MAX_SURFACE_DATA_URL_CHARS = 24 * 1024 * 1024;

export interface SurfaceResourceCacheEntry {
    dataUrl: string;
    expiresAtMs: number;
}

const [byId, setById] = createStore<Record<string, SurfaceResourceCacheEntry>>({});
const pending = new Set<string>();

const isUsable = (entry: SurfaceResourceCacheEntry | undefined, now = Date.now()): boolean =>
    !!entry && entry.expiresAtMs > now;

const clearExpired = (now = Date.now()): void => {
    for (const [resourceId, entry] of Object.entries(byId)) {
        if (!isUsable(entry, now)) setById(resourceId, undefined!);
    }
};

const begin = (resourceId: string): boolean => {
    clearExpired();
    if (isUsable(byId[resourceId]) || pending.has(resourceId)) return false;
    pending.add(resourceId);
    return true;
};

const complete = (resourceId: string, dataUrl: string, expiresAtMs: number): boolean => {
    pending.delete(resourceId);
    if (
        !/^sha256:[A-Fa-f0-9]{64}$/.test(resourceId) ||
        !/^data:[^;,]{1,160};base64,/.test(dataUrl) ||
        dataUrl.length > MAX_SURFACE_DATA_URL_CHARS ||
        !Number.isSafeInteger(expiresAtMs) ||
        expiresAtMs <= Date.now()
    ) {
        return false;
    }
    setById(resourceId, { dataUrl, expiresAtMs });
    return true;
};

const fail = (resourceId: string): void => {
    pending.delete(resourceId);
};

const resolve = (resourceId: string): string | undefined => {
    const entry = byId[resourceId];
    if (isUsable(entry)) return entry.dataUrl;
    if (entry) setById(resourceId, undefined!);
    return undefined;
};

const clearAll = (): void => {
    pending.clear();
    setById(reconcile({}));
};

export const surfaceResourceStore = {
    byId,
    actions: {
        begin,
        complete,
        fail,
        resolve,
        clearExpired,
        clearAll,
    },
};
