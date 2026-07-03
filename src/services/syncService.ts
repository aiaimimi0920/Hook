import { api } from "./api";
import { graphStore } from "../store/graphStore";
import { Unit, Link } from "../types/unit";
import { extraRects } from "./uiRegistry";
import { artLoom } from "./client";
import { WORKFLOW_ID } from "../constants";
import type { BootProfile } from "./bootProfile";
import type { StickerGroup } from "../types/stickerEditing";
import { getCapabilityInputsForPorts } from "./artPorts";
import { deriveUnitExecutionConfig } from "./nodeExecutionConfig";
import { buildSyncedImagePayload, normalizePreviewSrc } from "./syncedImagePayload";

// Local state for sync optimization (dirtiness check)
const lastSyncedSrcs = new Map<string, string>(); // Key: "workflowId:unitId" -> src

const buildUnitPorts = (unitType: "sticker" | "art", artId?: string) => {
    if (unitType === "sticker") {
        return {
            inputs: [{ id: "image", type: "image", direction: "input", label: "Image" }] as Unit["inputs"],
            outputs: [{ id: "output_image", type: "image", direction: "output", label: "Image" }] as Unit["outputs"],
        };
    }

    const capability = graphStore.capabilities.find((cap) => cap.id === artId);
    const inputs = getCapabilityInputsForPorts(capability, [{ name: "input_image", label: "Input", type: "image" }]).map((port) => ({
        id: port.name,
        label: port.label,
        type: (port.type as "image" | "text" | "any") || "any",
        direction: "input" as const,
    }));
    const outputs = (capability?.outputs || [{ name: "output_image", label: "Image", type: "image" }]).map((port) => ({
        id: port.name,
        label: port.label,
        type: (port.type as "image" | "text" | "any") || "any",
        direction: "output" as const,
    }));

    return { inputs, outputs };
};

const mapSessionStickerToUnit = (sticker: any): Unit => {
    const unitType: "sticker" | "art" = sticker.type === "art" || sticker.artId ? "art" : "sticker";
    const { inputs, outputs } = buildUnitPorts(unitType, sticker.artId);
    const capability = graphStore.capabilities.find((cap) => cap.id === sticker.artId);
    const executionConfig = deriveUnitExecutionConfig({
        capability,
        explicitConfig: sticker.executionConfig,
    });

    return {
        id: sticker.id,
        type: unitType,
        artId: sticker.artId || undefined,
        x: sticker.x,
        y: sticker.y,
        w: sticker.w,
        h: sticker.h,
        params: (sticker.params as Record<string, any>) || {},
        inputs,
        outputs,
        data: {
            src: sticker.src,
            minified: sticker.minified ?? false,
            savedRect: sticker.savedRect || undefined,
            cropOffset: sticker.cropOffset || undefined,
            opacityNormal: sticker.opacityNormal ?? 1,
            opacityMini: sticker.opacityMini ?? 0.9,
            previewSrc: sticker.previewSrc && sticker.previewSrc !== sticker.src ? sticker.previewSrc : undefined,
            filePath: sticker.filePath || undefined,
            rasterizedAnnotationLayerSrc: sticker.rasterizedAnnotationLayerSrc || undefined,
            outputs: sticker.outputs || undefined,
            originWorkflowId: sticker.originWorkflowId || undefined,
            originNodeId: sticker.originNodeId || undefined,
            executionConfig,
            annotationState: sticker.annotationState || undefined,
            imageEditState: sticker.imageEditState || undefined,
            groupId: sticker.groupId || undefined,
            captureMeta: sticker.captureMeta || undefined,
        },
    };
};

const mapUnitToSessionSticker = (unit: Unit) => ({
    id: unit.id,
    src: unit.data.src || "",
    x: unit.x,
    y: unit.y,
    w: unit.w,
    h: unit.h,
    minified: unit.data.minified ?? false,
    savedRect: unit.data.savedRect || null,
    cropOffset: unit.data.cropOffset || null,
    opacityNormal: unit.data.opacityNormal ?? 1,
    opacityMini: unit.data.opacityMini ?? 0.9,
    type: unit.type,
    artId: unit.artId || null,
    params: unit.params || {},
    filePath: unit.data.filePath || null,
    previewSrc: normalizePreviewSrc(unit) || null,
    rasterizedAnnotationLayerSrc: unit.data.rasterizedAnnotationLayerSrc || null,
    outputs: unit.data.outputs || null,
    originWorkflowId: unit.data.originWorkflowId || null,
    originNodeId: unit.data.originNodeId || null,
    executionConfig: unit.data.executionConfig || null,
    annotationState: unit.data.annotationState || null,
    imageEditState: unit.data.imageEditState || null,
    groupId: unit.data.groupId || null,
    captureMeta: unit.data.captureMeta || null,
});

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
                // If changes happened during sync, trigger again immediately
                this.trigger();
            }
        }
    }
}

const executeSyncCycle = async () => {
    const currentUnits = graphStore.units;
    const currentLinks = graphStore.links;
    const unitParams = graphStore.unitParams;
    const pendingImageCommits = new Map<string, string>(); // Commit these only on success

    // Helper to check dirtiness but defer commit
    const shouldSyncImage = (u: Unit, targetWfId: string) => {
        const key = `${targetWfId}:${u.id}`;
        const last = lastSyncedSrcs.get(key);
        const currentImg = u.data?.previewSrc || u.data?.src;
        const forceImageSync = targetWfId === WORKFLOW_ID;
        if (forceImageSync && currentImg) {
            pendingImageCommits.set(key, currentImg);
            return true;
        }
        if (currentImg && currentImg !== last) {
            pendingImageCommits.set(key, currentImg);
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
    const syncPromises: Promise<any>[] = [];

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

            const rfNodes = componentUnits.map(u => {
                const syncImg = shouldSyncImage(u, dominantWfId!);
                return {
                    id: u.data?.originNodeId || u.id,
                    type: 'artNode',
                    position: { x: u.x, y: u.y },
                    data: {
                        label: u.artId || "Node",
                        art_id: u.artId,
                        artId: u.artId,
                        params: unitParams[u.id] || u.params || {},
                        ...(syncImg ? buildSyncedImagePayload(u) : {}),
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
                nodes: rfNodes,
                edges: rfEdges,
                viewport: { x: 0, y: 0, zoom: 1 }
            };

            syncPromises.push(artLoom.syncWorkflow(dominantWfId, snapshot));

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
    for (const key of lastSyncedSrcs.keys()) {
            const [wfId, unitId] = key.split(':');
            if (wfId === WORKFLOW_ID && !currentUnitIds.has(unitId)) {
                lastSyncedSrcs.delete(key);
            }
    }

    const globalRfNodes = currentUnits.map(u => {
        const syncImg = shouldSyncImage(u, WORKFLOW_ID);
        const artLoomType = u.type === 'sticker' ? 'sticker' : 'artNode';

        return {
            id: u.id,
            type: artLoomType,
            position: { x: u.x, y: u.y },
            data: {
                label: u.artId || "Node",
                art_id: u.artId,
                artId: u.artId,
                params: unitParams[u.id] || u.params || {},
                ...(syncImg ? buildSyncedImagePayload(u) : {}),
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

    syncPromises.push(artLoom.syncWorkflow(WORKFLOW_ID, {
        nodes: globalRfNodes,
        edges: globalRfEdges,
        viewport: { x: 0, y: 0, zoom: 1 }
    }));

    // Wait for all syncs to complete
    await Promise.all(syncPromises);

    // Commit image state updates
    pendingImageCommits.forEach((val, key) => lastSyncedSrcs.set(key, val));

    // Persist the current local runtime state after a successful sync cycle.
    await api.saveSession(
        graphStore.units.map(mapUnitToSessionSticker),
        graphStore.links.map(mapLinkToSessionLink),
        graphStore.stickerGroups.map(mapGroupToSessionGroup),
        graphStore.recycleBin.map((entry) => entry),
        graphStore.referenceLibrary.map((entry) => entry),
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

    restoreSession: async (bootProfile?: BootProfile) => {
        try {
            const sessionData = await api.loadSession();
            if (sessionData) {
                 const loadedUnits = (sessionData.stickers || []).map(mapSessionStickerToUnit);
                 const loadedLinks = (sessionData.links || []).map((link: any) => ({
                     id: link.id,
                     fromUnitId: link.fromUnitId,
                     fromPortId: link.fromPortId,
                     toUnitId: link.toUnitId,
                     toPortId: link.toPortId,
                 }));

                 // Populate Stores
                 graphStore.setUnits(loadedUnits);
                 graphStore.setLinks(loadedLinks);
                 graphStore.setStickerGroups((sessionData.groups || []) as StickerGroup[]);
                 graphStore.setRecycleBin((sessionData.recycleBin || []) as any);
                 graphStore.setReferenceLibrary((sessionData.referenceLibrary || []) as any);

                 // Populate Params Map
                 const paramsMap: any = {};
                 const execConfigMap: any = {};
                 loadedUnits.forEach((u: any) => paramsMap[u.id] = u.params || {});
                 loadedUnits.forEach((u: any) => {
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
