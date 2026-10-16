import { listen } from "@tauri-apps/api/event";
import type { Setter } from "solid-js";

import { graphStore } from "../features/workspace/state/graphStore";
import type { AppSettings, OtterCacheSettings } from "../features/settings/types/appSettings";
import {
    getCurrentAppSettings,
    normalizeOtterCacheSettings,
    saveCurrentAppSettings,
} from "../features/settings/services/appSettings";
import type { AppListenerRegistry } from "./appListenerRegistry";
import { api } from "../platform/tauri/api";
import { runBackgroundTask } from "../shared/async/backgroundTask";
import { logger } from "../shared/diagnostics/logger";
import { pruneRecycleBinEntries } from "../features/stickers/services/stickerLibraryModel";
import { syncService } from "../features/workspace/services/syncService";
import {
    normalizeWorkflowSnapshotPayload,
    type WorkflowSnapshotPayload,
} from "../features/workspace/services/workflowPayload";

type OtterCacheControlPayload = {
    action?: "settings" | "clearRecycleBin" | "clearReferenceLibrary";
    settings?: Partial<OtterCacheSettings>;
};

type AppArtControlListenerDependencies = {
    registry: AppListenerRegistry;
    instantiateWorkflowSnapshot: (payload: WorkflowSnapshotPayload) => Promise<void>;
    refreshCapabilities: () => Promise<void>;
    applyLoomManagedSettings: (settings: unknown) => Promise<void>;
    setAppSettings: Setter<AppSettings>;
};

/** Registers workflow, cache, settings, and bridge-state control listeners. */
export async function registerAppArtControlListeners({
    registry,
    instantiateWorkflowSnapshot,
    refreshCapabilities,
    applyLoomManagedSettings,
    setAppSettings,
}: AppArtControlListenerDependencies): Promise<void> {
    await registry.register(() => listen("art/instantiate", (event) => {
        logger.debug("Received workflow instantiation payload");
        runBackgroundTask(
            "workflow instantiation",
            instantiateWorkflowSnapshot(normalizeWorkflowSnapshotPayload(event.payload)),
        );
    }));

    await registry.register(() => listen("art/capabilities_updated", async () => {
        logger.debug("Capabilities changed, refreshing handshake state");
        try {
            await refreshCapabilities();
        } catch (error) {
            console.error("Failed to refresh capabilities", error);
        }
    }));

    await registry.register(() => listen<OtterCacheControlPayload>(
        "hook/cache_control",
        (event) => {
            runBackgroundTask("cache control", (async () => {
                const action = event.payload?.action;
                if (action === "settings" && event.payload.settings) {
                    const cache = normalizeOtterCacheSettings(event.payload.settings);
                    const saved = await saveCurrentAppSettings({
                        ...getCurrentAppSettings(),
                        cache,
                    });
                    setAppSettings(saved);
                    const pruned = pruneRecycleBinEntries(graphStore.recycleBin);
                    if (pruned.length !== graphStore.recycleBin.length) {
                        graphStore.setRecycleBin(pruned);
                        await syncService.performWorkflowSync();
                    }
                    return;
                }
                if (action === "clearRecycleBin") {
                    graphStore.setRecycleBin([]);
                    await syncService.performWorkflowSync();
                    return;
                }
                if (action === "clearReferenceLibrary") {
                    graphStore.setReferenceLibrary([]);
                    await syncService.performWorkflowSync();
                }
            })());
        },
    ));

    await registry.register(() => listen<{ settings?: unknown }>(
        "hook/settings_updated",
        (event) => runBackgroundTask(
            "Loom-managed settings update",
            applyLoomManagedSettings(event.payload?.settings),
        ),
    ));
    await applyLoomManagedSettings(await api.getLoomShortcutSettings());

    await registry.register(() => listen<{ connected?: boolean }>(
        "art/loom_connection_state",
        async (event) => {
            if (!event.payload?.connected) {
                console.warn("Loom Otter desktop bridge disconnected");
                return;
            }
            logger.debug("Loom Otter desktop bridge connected, refreshing capabilities");
            try {
                await refreshCapabilities();
            } catch (error) {
                console.error("Failed to refresh capabilities after reconnect", error);
            }
        },
    ));
}
