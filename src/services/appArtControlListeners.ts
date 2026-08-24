import { listen } from "@tauri-apps/api/event";
import type { Setter } from "solid-js";

import { graphStore } from "../store/graphStore";
import type { AppSettings, HookCacheSettings } from "../types/appSettings";
import {
    getCurrentAppSettings,
    normalizeHookCacheSettings,
    saveCurrentAppSettings,
} from "./appSettings";
import type { AppListenerRegistry } from "./appListenerRegistry";
import { api } from "./api";
import { runBackgroundTask } from "./backgroundTask";
import { logger } from "./logger";
import { pruneRecycleBinEntries } from "./stickerLibraryModel";
import { syncService } from "./syncService";
import {
    normalizeWorkflowSnapshotPayload,
    type WorkflowSnapshotPayload,
} from "./workflowPayload";

type HookCacheControlPayload = {
    action?: "settings" | "clearRecycleBin" | "clearReferenceLibrary";
    settings?: Partial<HookCacheSettings>;
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

    await registry.register(() => listen<HookCacheControlPayload>(
        "hook/cache_control",
        (event) => {
            runBackgroundTask("cache control", (async () => {
                const action = event.payload?.action;
                if (action === "settings" && event.payload.settings) {
                    const cache = normalizeHookCacheSettings(event.payload.settings);
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
                console.warn("Loom Hook desktop bridge disconnected");
                return;
            }
            logger.debug("Loom Hook desktop bridge connected, refreshing capabilities");
            try {
                await refreshCapabilities();
            } catch (error) {
                console.error("Failed to refresh capabilities after reconnect", error);
            }
        },
    ));
}
