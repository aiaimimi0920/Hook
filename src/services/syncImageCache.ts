export const lastSyncedImageSignatures = new Map<string, string>();
export const bakedSyncPreviewCache = new Map<string, { signature: string; src: string }>();

export interface SyncImageCacheToken {
    readonly workspaceGeneration: number;
    readonly revision: number;
}

let workspaceGeneration = 0;
let nextTokenRevision = 0;
const unitTokens = new Map<string, SyncImageCacheToken>();

export const getSyncImageCacheEpoch = () => workspaceGeneration;

export const isSyncImageCacheEpochCurrent = (epoch: number) =>
    workspaceGeneration === epoch;

export const getSyncImageCacheToken = (unitId: string): SyncImageCacheToken => {
    const existing = unitTokens.get(unitId);
    if (existing) {
        return existing;
    }

    const token = {
        workspaceGeneration,
        revision: ++nextTokenRevision,
    };
    unitTokens.set(unitId, token);
    return token;
};

export const isSyncImageCacheTokenCurrent = (
    unitId: string,
    token: SyncImageCacheToken,
) => workspaceGeneration === token.workspaceGeneration && unitTokens.get(unitId) === token;

export const clearSyncImageCachesForUnit = (unitId: string) => {
    unitTokens.delete(unitId);
    for (const key of lastSyncedImageSignatures.keys()) {
        if (key.endsWith(`:${unitId}`)) {
            lastSyncedImageSignatures.delete(key);
        }
    }
    bakedSyncPreviewCache.delete(unitId);
};

export const clearAllSyncImageCaches = () => {
    workspaceGeneration += 1;
    unitTokens.clear();
    lastSyncedImageSignatures.clear();
    bakedSyncPreviewCache.clear();
};

export const retainSyncImageCachesForUnits = (unitIds: ReadonlySet<string>) => {
    const staleUnitIds = new Set<string>();
    for (const unitId of unitTokens.keys()) {
        if (!unitIds.has(unitId)) {
            staleUnitIds.add(unitId);
        }
    }
    for (const key of lastSyncedImageSignatures.keys()) {
        const separatorIndex = key.lastIndexOf(":");
        const unitId = separatorIndex >= 0 ? key.slice(separatorIndex + 1) : key;
        if (!unitIds.has(unitId)) {
            staleUnitIds.add(unitId);
        }
    }
    for (const unitId of bakedSyncPreviewCache.keys()) {
        if (!unitIds.has(unitId)) {
            staleUnitIds.add(unitId);
        }
    }
    staleUnitIds.forEach(clearSyncImageCachesForUnit);
};
