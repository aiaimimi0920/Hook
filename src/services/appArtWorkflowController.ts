import { graphStore } from "../store/graphStore";
import { selectionActions, uiActions } from "../store/uiStore";
import type { AppSettings } from "../types/appSettings";
import { api } from "./api";
import { supportsShaderPreview } from "./artCapabilities";
import {
    getCurrentAppSettings,
    normalizeHookCacheSettings,
    saveCurrentAppSettings,
} from "./appSettings";
import { loomHook } from "./client";
import {
    applyHookGeneralSettings,
    normalizeHookGeneralSettings,
} from "./hookGeneralSettings";
import type { ArtCapability } from "./protocol";
import { shaderCache } from "./shaderCache";
import { pruneRecycleBinEntries } from "./stickerLibraryModel";
import { syncService } from "./syncService";
import {
    buildWorkflowInstantiation,
    mergeInstantiatedLinks,
    mergeInstantiatedUnits,
} from "./workflowInstantiation";
import type { WorkflowSnapshotPayload } from "./workflowPayload";

type AppArtWorkflowControllerDependencies = {
    setAppSettings: (settings: AppSettings) => void;
    applyLoomShortcutSettings: (settings: unknown) => void;
};

const isContextualShaderArt = (art: ArtCapability) =>
    supportsShaderPreview(art)
    && ((art.params || []).some(
        (param) => param.widget === "image_link" || param.id === "reference",
    ) || (art.inputs || []).some((input) => input.name === "reference"));

/** Owns capability refresh, Loom-managed settings, and workflow materialization. */
export function createAppArtWorkflowController(
    dependencies: AppArtWorkflowControllerDependencies,
) {
    let capabilityRefreshPromise: Promise<void> | null = null;

    const refreshCapabilities = async () => {
        if (capabilityRefreshPromise) return capabilityRefreshPromise;
        capabilityRefreshPromise = (async () => {
            const handshake = await loomHook.connect();
            const arts = handshake.capabilities.artDefinitions;
            graphStore.setCapabilities(arts);
            arts
                .filter((art) => supportsShaderPreview(art) && !isContextualShaderArt(art))
                .forEach((art) => void shaderCache.prefetchShader(art.id));
        })();

        try {
            await capabilityRefreshPromise;
        } finally {
            capabilityRefreshPromise = null;
        }
    };

    const applyLoomManagedSettings = async (settings: unknown) => {
        if (!settings || typeof settings !== "object") return;
        dependencies.applyLoomShortcutSettings(settings);
        const record = settings as Record<string, unknown>;
        applyHookGeneralSettings(normalizeHookGeneralSettings(record.hook_general));

        const hookCache = record.hookCache;
        if (!hookCache || typeof hookCache !== "object") return;
        const cache = normalizeHookCacheSettings(hookCache);
        const saved = await saveCurrentAppSettings({
            ...getCurrentAppSettings(),
            cache,
        });
        dependencies.setAppSettings(saved);
        const pruned = pruneRecycleBinEntries(graphStore.recycleBin);
        if (pruned.length !== graphStore.recycleBin.length) {
            graphStore.setRecycleBin(pruned);
            await syncService.performWorkflowSync();
        }
    };

    const instantiateWorkflowSnapshot = async (payload: WorkflowSnapshotPayload) => {
        const result = buildWorkflowInstantiation(payload, {
            existingUnits: graphStore.units,
            capabilities: graphStore.capabilities,
            newId: () => crypto.randomUUID(),
        });
        if (!result) return;
        const { units, links, referencedLocalIds } = result;

        graphStore.setUnits((previous) => mergeInstantiatedUnits(previous, units));
        graphStore.setLinks((previous) =>
            mergeInstantiatedLinks(previous, links, referencedLocalIds));
        graphStore.setUnitParams((previous) => {
            const next = { ...previous };
            units.forEach((unit) => {
                next[unit.id] = unit.params || {};
            });
            return next;
        });
        graphStore.setUnitExecConfig((previous) => {
            const next = { ...previous };
            units.forEach((unit) => {
                if (unit.data.executionConfig) next[unit.id] = unit.data.executionConfig;
                else delete next[unit.id];
            });
            return next;
        });

        selectionActions.clear();
        uiActions.setSelectedStickerAnnotation(null);
        await api.setMouseMonitorActive(true);
        await syncService.updateBackendRects();
        await syncService.performWorkflowSync();
    };

    return { refreshCapabilities, applyLoomManagedSettings, instantiateWorkflowSnapshot };
}
