import { api, type SessionData } from "./api";
import { graphStore } from "../store/graphStore";
import { Unit, Link, WorkflowAssetArchiveHints } from "../types/unit";
import { extraRects } from "./uiRegistry";
import { artLoom } from "./client";
import { WORKFLOW_ID } from "../constants";
import type { BootProfile } from "./bootProfile";
import type { StickerGroup } from "../types/stickerEditing";
import { mapSessionStickerToUnit, detectUnknownSessionStickerKeys } from "./sessionStickerMapping";
import {
    buildSyncedImagePayload,
    buildSyncedImageSignature,
} from "./syncedImagePayload";
import {
    renderStickerCompositeWithAnnotations,
    resolveStickerCompositeBaseImageSrc,
} from "./stickerExport";
import { buildSessionStickersForSave } from "./sessionStickerPayload";
import {
    bakedSyncPreviewCache,
    getSyncImageCacheEpoch,
    getSyncImageCacheToken,
    isSyncImageCacheEpochCurrent,
    isSyncImageCacheTokenCurrent,
    lastSyncedImageSignatures,
    retainSyncImageCachesForUnits,
    type SyncImageCacheToken,
} from "./syncImageCache";

const mapLinkToSessionLink = (link: Link) => ({
    id: link.id,
    fromUnitId: link.fromUnitId,
    fromPortId: link.fromPortId,
    toUnitId: link.toUnitId,
    toPortId: link.toPortId,
});

const mapGroupToSessionGroup = (group: StickerGroup) => ({
    id: group.id,
    name: group.name,
    hidden: group.hidden ?? false,
    locked: group.locked ?? false,
});

const ensureWorkflowArchiveHint = (
    hints: WorkflowAssetArchiveHints,
    workflowId: string,
) => {
    if (!hints.workflows[workflowId]) {
        hints.workflows[workflowId] = { nodes: {} };
    }
    return hints.workflows[workflowId];
};

class SyncScheduler {
    private debounceTimer: number | null = null;
    private isSyncing = false;
    private retryCount = 0;
    private hasPendingSync = false;
    private readonly MAX_RETRIES = 5;
    private readonly DEBOUNCE_MS = 50;

    constructor(private doSync: () => Promise<void>) {}

    public schedule() {
        if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
        this.hasPendingSync = true;

        this.debounceTimer = window.setTimeout(() => {
            this.trigger();
        }, this.DEBOUNCE_MS);
    }

    private async trigger() {
        if (this.isSyncing) return;

        this.isSyncing = true;
        this.hasPendingSync = false;

        try {
            await this.doSync();
            this.retryCount = 0; // Reset on success
        } catch (e) {
            console.error("Sync cycle failed", e);
            if (this.retryCount < this.MAX_RETRIES) {
                this.retryCount++;
                const delay = Math.min(1000 * Math.pow(2, this.retryCount), 10000); // Exponential backoff cap at 10s
                console.log(`Retrying sync in ${delay}ms (Attempt ${this.retryCount}/${this.MAX_RETRIES})`);
                setTimeout(() => {
                    this.hasPendingSync = true;
                    this.trigger();
                }, delay);
            } else {
                console.error("Max sync retries reached. Giving up until next trigger.");
            }
        } finally {
            this.isSyncing = false;
            if (this.hasPendingSync) {
                // Changes arrived during the sync. Re-run through the debounce
                // window instead of an immediate re-entrant trigger(), so
                // sustained writes (e.g. a live erase patching per frame) cannot
                // spin full sync + saveSession cycles back-to-back with no gap.
                this.schedule();
            }
        }
    }
}

const executeSyncCycle = async () => {
    const syncEpoch = getSyncImageCacheEpoch();
    const currentUnits = graphStore.units;
    const currentLinks = graphStore.links;
    const unitParams = graphStore.unitParams;
    const pendingImageCommits = new Map<string, {
        unitId: string;
        token: SyncImageCacheToken;
        signature: string;
    }>();
    const workflowAssetArchiveHints: WorkflowAssetArchiveHints = { workflows: {} };

    const resolveBakedPreviewDisplaySrc = (unit: Unit) =>
        resolveStickerCompositeBaseImageSrc({
            unit,
            units: currentUnits,
            links: currentLinks,
            capabilities: graphStore.capabilities,
        });

    const buildBakedPreviewSignature = (unit: Unit) =>
        buildSyncedImageSignature(unit, {
            displaySrcOverride: resolveBakedPreviewDisplaySrc(unit) ?? null,
        });

    const renderBakedPreviewSrc = async (unit: Unit) => {
        const cacheToken = getSyncImageCacheToken(unit.id);
        const baseImageSrcOverride = resolveBakedPreviewDisplaySrc(unit);
        const signature = buildBakedPreviewSignature(unit);
        if (!signature) {
            return baseImageSrcOverride || unit.data.previewSrc || unit.data.src || "";
        }

        const cached = bakedSyncPreviewCache.get(unit.id);
        if (cached?.signature === signature) {
            return cached.src;
        }

        const bakedPreviewSrc = await renderStickerCompositeWithAnnotations(
            unit,
            unit.data.annotationState?.elements || [],
            { baseImageSrcOverride },
        );
        if (
            isSyncImageCacheTokenCurrent(unit.id, cacheToken) &&
            graphStore.units.some((candidate) => candidate.id === unit.id)
        ) {
            bakedSyncPreviewCache.set(unit.id, { signature, src: bakedPreviewSrc });
        }
        return bakedPreviewSrc;
    };

    // Helper to check dirtiness but defer commit
    const shouldSyncImage = (u: Unit, targetWfId: string) => {
        const key = `${targetWfId}:${u.id}`;
        const last = lastSyncedImageSignatures.get(key);
        const currentSignature = buildBakedPreviewSignature(u);
        const cacheToken = getSyncImageCacheToken(u.id);
        const forceImageSync = targetWfId === WORKFLOW_ID;
        if (forceImageSync && currentSignature) {
            pendingImageCommits.set(key, {
                unitId: u.id,
                token: cacheToken,
                signature: currentSignature,
            });
            return true;
        }
        if (currentSignature && currentSignature !== last) {
            pendingImageCommits.set(key, {
                unitId: u.id,
                token: cacheToken,
                signature: currentSignature,
            });
            return true;
        }
        return false;
    };

    // 1. Build Graph Adjacency
    const adj: Record<string, string[]> = {};
    currentUnits.forEach(u => adj[u.id] = []);
    currentLinks.forEach(l => {
        if (!adj[l.fromUnitId]) adj[l.fromUnitId] = [];
        if (!adj[l.toUnitId]) adj[l.toUnitId] = [];

        if (!adj[l.fromUnitId].includes(l.toUnitId)) adj[l.fromUnitId].push(l.toUnitId);
        if (!adj[l.toUnitId].includes(l.fromUnitId)) adj[l.toUnitId].push(l.fromUnitId);
    });

    const visited = new Set<string>();
    const syncRequests: Array<{ workflowId: string; snapshot: unknown }> = [];

    // 2. Component Sync
    for (const unit of currentUnits) {
        if (visited.has(unit.id)) continue;

        // Start BFS for Component
        const componentUnits: Unit[] = [];
        const queue = [unit.id];
        visited.add(unit.id);

        const workflowCounts: Record<string, number> = {};

        while (queue.length > 0) {
            const currId = queue.shift()!;
            const currUnit = currentUnits.find(u => u.id === currId);
            if (!currUnit) continue;

            componentUnits.push(currUnit);

            if (currUnit.data?.originWorkflowId) {
                const wid = currUnit.data.originWorkflowId;
                workflowCounts[wid] = (workflowCounts[wid] || 0) + 1;
            }

            for (const neighbor of adj[currId] || []) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }

        // Determine Winner (Dominant Workflow)
        let dominantWfId: string | null = null;
        let maxCount = 0;
        for (const [wid, count] of Object.entries(workflowCounts)) {
            if (count > maxCount) {
                maxCount = count;
                dominantWfId = wid;
            }
        }

        if (dominantWfId) {
            const componentIds = new Set(componentUnits.map(u => u.id));
            const workflowArchiveHint = ensureWorkflowArchiveHint(workflowAssetArchiveHints, dominantWfId);
            componentUnits.forEach((u) => {
                workflowArchiveHint.nodes[u.data?.originNodeId || u.id] = { stickerId: u.id };
            });

            const rfNodes = componentUnits.map(async (u) => {
                const syncImg = shouldSyncImage(u, dominantWfId!);
                const imagePayload = syncImg
                    ? await buildSyncedImagePayload(u, { renderBakedPreviewSrc })
                    : {};
                return {
                    id: u.data?.originNodeId || u.id,
                    type: 'artNode',
                    position: { x: u.x, y: u.y },
                    data: {
                        label: u.artId || "Node",
                        art_id: u.artId,
                        artId: u.artId,
                        params: unitParams[u.id] || u.params || {},
                        ...imagePayload,
                        outputs: u.data?.outputs || null,
                        w: u.w, h: u.h,
                        minified: u.data?.minified,
                        savedRect: u.data?.savedRect,
                        cropOffset: u.data?.cropOffset,
                        opacityNormal: u.data?.opacityNormal,
                        opacityMini: u.data?.opacityMini,
                        executionConfig: graphStore.unitExecConfig[u.id] || u.data?.executionConfig
                    },
                    measured: { width: u.w, height: u.h },
                };
            });

            const rfEdges = currentLinks
                .filter(l => componentIds.has(l.fromUnitId) && componentIds.has(l.toUnitId))
                .map(l => ({
                    id: l.id,
                    source: currentUnits.find(u => u.id === l.fromUnitId)?.data?.originNodeId || l.fromUnitId,
                    target: currentUnits.find(u => u.id === l.toUnitId)?.data?.originNodeId || l.toUnitId,
                    sourceHandle: l.fromPortId || "output",
                    targetHandle: l.toPortId || "input"
                }));

            const snapshot = {
                nodes: await Promise.all(rfNodes),
                edges: rfEdges,
                viewport: { x: 0, y: 0, zoom: 1 }
            };
            if (!isSyncImageCacheEpochCurrent(syncEpoch)) {
                return;
            }

            syncRequests.push({ workflowId: dominantWfId, snapshot });

            // Optimistic update of origin info for nodes that were just adopted
            const neededUpdates = componentUnits.filter(u => u.data?.originWorkflowId !== dominantWfId);
            if (neededUpdates.length > 0) {
                 graphStore.setUnits(prev => prev.map(u => {
                     if (neededUpdates.some(nu => nu.id === u.id)) {
                         return {
                             ...u,
                             data: {
                                 ...u.data,
                                 originWorkflowId: dominantWfId!,
                                 originNodeId: u.data?.originNodeId || u.id
                             }
                         };
                     }
                     return u;
                 }));
            }
        }
    }

    // 3. DUAL SYNC (Global)
    // Cleanup Stale Cache
    const currentUnitIds = new Set(currentUnits.map(u => u.id));
    retainSyncImageCachesForUnits(currentUnitIds);

    const globalRfNodes = currentUnits.map(async (u) => {
        const syncImg = shouldSyncImage(u, WORKFLOW_ID);
        const artLoomType = u.type === 'sticker' ? 'sticker' : 'artNode';
        const imagePayload = syncImg
            ? await buildSyncedImagePayload(u, { renderBakedPreviewSrc })
            : {};

        return {
            id: u.id,
            type: artLoomType,
            position: { x: u.x, y: u.y },
            data: {
                label: u.artId || "Node",
                art_id: u.artId,
                artId: u.artId,
                params: unitParams[u.id] || u.params || {},
                ...imagePayload,
                outputs: u.data?.outputs || null,
                w: u.w, h: u.h,
                minified: u.data?.minified,
                savedRect: u.data?.savedRect,
                cropOffset: u.data?.cropOffset,
                opacityNormal: u.data?.opacityNormal,
                opacityMini: u.data?.opacityMini,
                executionConfig: graphStore.unitExecConfig[u.id] || u.data?.executionConfig
            },
            measured: { width: u.w, height: u.h }
        };
    });

    const globalRfEdges = currentLinks.map(l => ({
        id: l.id,
        source: l.fromUnitId,
        target: l.toUnitId,
        sourceHandle: l.fromPortId || "output",
        targetHandle: l.toPortId || "input"
    }));

    const globalSnapshot = {
        nodes: await Promise.all(globalRfNodes),
        edges: globalRfEdges,
        viewport: { x: 0, y: 0, zoom: 1 }
    };
    if (!isSyncImageCacheEpochCurrent(syncEpoch)) {
        return;
    }
    syncRequests.push({ workflowId: WORKFLOW_ID, snapshot: globalSnapshot });
    const liveWorkflowArchiveHint = ensureWorkflowArchiveHint(workflowAssetArchiveHints, WORKFLOW_ID);
    currentUnits.forEach((u) => {
        liveWorkflowArchiveHint.nodes[u.id] = { stickerId: u.id };
    });

    // Wait for all syncs to complete
    await Promise.all(
        syncRequests.map(({ workflowId, snapshot }) =>
            artLoom.syncWorkflow(workflowId, snapshot)
        ),
    );
    if (!isSyncImageCacheEpochCurrent(syncEpoch)) {
        return;
    }

    // Commit image state updates
    const liveUnitIds = new Set(graphStore.units.map((unit) => unit.id));
    pendingImageCommits.forEach(({ unitId, token, signature }, key) => {
        if (liveUnitIds.has(unitId) && isSyncImageCacheTokenCurrent(unitId, token)) {
            lastSyncedImageSignatures.set(key, signature);
        }
    });

    // Persist the current local runtime state after a successful sync cycle.
    const sessionStickers = await buildSessionStickersForSave(graphStore.units, {
        renderBakedPreviewSrc,
        previewCache: bakedSyncPreviewCache,
        buildPreviewSignature: buildBakedPreviewSignature,
        paramsByUnitId: graphStore.unitParams,
    });
    if (!isSyncImageCacheEpochCurrent(syncEpoch)) {
        return;
    }

    await api.saveSession(
        sessionStickers,
        graphStore.links.map(mapLinkToSessionLink),
        graphStore.stickerGroups.map(mapGroupToSessionGroup),
        graphStore.recycleBin.map((entry) => entry),
        graphStore.referenceLibrary.map((entry) => entry),
        workflowAssetArchiveHints,
    );
};

const scheduler = new SyncScheduler(executeSyncCycle);

export const syncService = {
    updateBackendRects: async () => {
        const dpr = window.devicePixelRatio || 1;

        // 1. Base Units
        const rects = graphStore.units.map(u => ({
            id: u.id,
            x: Math.round(u.x * dpr),
            y: Math.round(u.y * dpr),
            width: Math.round(u.w * dpr),
            height: Math.round(u.h * dpr),
            name: u.data.minified ? "MINI" : "FULL"
        }));

        // 2. Dynamic UI Registry (Overlays)
        const overlays = extraRects();
        overlays.forEach(r => {
            rects.push({
                id: r.name,
                x: Math.round(r.x * dpr),
                y: Math.round(r.y * dpr),
                width: Math.round(r.width * dpr),
                height: Math.round(r.height * dpr),
                name: r.name
            });
        });

        try {
            await api.updatePinRects(rects);

        } catch (e) {
            console.error("Failed to update backend rects:", e);
        }
    },

    restoreSession: async (
        bootProfile?: BootProfile,
        preloadedSessionData?: SessionData | null,
    ) => {
        try {
            const sessionData = preloadedSessionData ?? await api.loadSession();
            if (sessionData) {
                 const rawStickers = sessionData.stickers || [];
                 const loadedUnits = rawStickers.map((s) =>
                     mapSessionStickerToUnit(s, { capabilities: graphStore.capabilities }),
                 );

                 // Diagnostic only: surface persisted sticker fields the loader no
                 // longer recognizes (e.g. a renamed backend field silently dropped
                 // on load). Never rejects — a drifted session still loads.
                 const unknownStickerKeys = new Set<string>();
                 rawStickers.forEach((s) => {
                     for (const key of detectUnknownSessionStickerKeys(s as unknown as Record<string, unknown>)) {
                         unknownStickerKeys.add(key);
                     }
                 });
                 if (unknownStickerKeys.size > 0) {
                     console.warn(
                         `[session] loaded with ${unknownStickerKeys.size} unrecognized sticker field(s), data for these is ignored: ${[...unknownStickerKeys].join(", ")}`,
                     );
                 }
                 const loadedLinks = (sessionData.links || []).map((link) => ({
                     id: link.id,
                     fromUnitId: link.fromUnitId,
                     fromPortId: link.fromPortId,
                     toUnitId: link.toUnitId,
                     toPortId: link.toPortId,
                 }));

                 // Populate Stores
                 graphStore.actions.replaceUnits(loadedUnits);
                 graphStore.setLinks(loadedLinks);
                 graphStore.setStickerGroups((sessionData.groups || []) as StickerGroup[]);
                 graphStore.setRecycleBin((sessionData.recycleBin || []) as any);
                 graphStore.setReferenceLibrary((sessionData.referenceLibrary || []) as any);

                 // Populate Params Map
                 const paramsMap: any = {};
                 const execConfigMap: any = {};
                 loadedUnits.forEach((u) => paramsMap[u.id] = u.params || {});
                 loadedUnits.forEach((u) => {
                     execConfigMap[u.id] = u.data?.executionConfig;
                 });
                 graphStore.setUnitParams(paramsMap);
                 graphStore.setUnitExecConfig(execConfigMap);

                 // Update Backend Geometry after state restore. Startup visibility is
                 // already owned by Rust setup, so do not re-show overlay/canvas here.
                 syncService.updateBackendRects();
                 if (bootProfile?.initialUiMode === "overlay" && loadedUnits.length > 0) {
                     await api.setMouseMonitorActive(true);
                     await syncService.updateBackendRects();
                 }
            }
        } catch (e) {
            console.error("Session Load Failed:", e);
        }
    },

    performWorkflowSync: async () => {
        scheduler.schedule();
    }
};
