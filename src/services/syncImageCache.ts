import { createSignal } from "solid-js";
import type { Unit } from "../types/unit";
import { buildSyncedImageSignature } from "./syncedImagePayload";

export const lastSyncedImageSignatures = new Map<string, string>();
type BakedSyncPreviewCacheEntry = { signature: string; src: string };
const mutableBakedSyncPreviewCache = new Map<string, BakedSyncPreviewCacheEntry>();
export const bakedSyncPreviewCache: ReadonlyMap<string, BakedSyncPreviewCacheEntry> =
    mutableBakedSyncPreviewCache;
export const [bakedSyncPreviewCacheRevision, setBakedSyncPreviewCacheRevision] =
    createSignal(0);

const bumpBakedSyncPreviewCacheRevision = () => {
    setBakedSyncPreviewCacheRevision((revision) => revision + 1);
};

export const setBakedSyncPreviewCacheEntry = (
    unitId: string,
    entry: BakedSyncPreviewCacheEntry,
) => {
    const previous = mutableBakedSyncPreviewCache.get(unitId);
    if (previous?.signature === entry.signature && previous.src === entry.src) return;
    mutableBakedSyncPreviewCache.set(unitId, entry);
    bumpBakedSyncPreviewCacheRevision();
};

export const deleteBakedSyncPreviewCacheEntry = (unitId: string) => {
    if (!mutableBakedSyncPreviewCache.delete(unitId)) return;
    bumpBakedSyncPreviewCacheRevision();
};

export const resolveCachedBakedSyncPreview = (
    unit: Unit,
    displaySrcOverride: string | null,
) => {
    const signature = buildSyncedImageSignature(unit, { displaySrcOverride });
    if (!signature) return undefined;
    const cached = mutableBakedSyncPreviewCache.get(unit.id);
    return cached?.signature === signature ? cached.src : undefined;
};

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
    deleteBakedSyncPreviewCacheEntry(unitId);
};

export const clearAllSyncImageCaches = () => {
    workspaceGeneration += 1;
    unitTokens.clear();
    lastSyncedImageSignatures.clear();
    if (mutableBakedSyncPreviewCache.size > 0) {
        mutableBakedSyncPreviewCache.clear();
        bumpBakedSyncPreviewCacheRevision();
    }
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
    for (const unitId of mutableBakedSyncPreviewCache.keys()) {
        if (!unitIds.has(unitId)) {
            staleUnitIds.add(unitId);
        }
    }
    staleUnitIds.forEach(clearSyncImageCachesForUnit);
};
