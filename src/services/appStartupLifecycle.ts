import { onCleanup, onMount, type Setter } from "solid-js";

import { graphStore } from "../store/graphStore";
import { surfaceResourceStore } from "../store/surfaceResourceStore";
import { uiActions } from "../store/uiStore";
import type { AppSettings } from "../types/appSettings";
import { api, listenBrowserLoomHookMethod, type VoiceSettingsSummary } from "./api";
import { AppListenerRegistry } from "./appListenerRegistry";
import { registerAppArtControlListeners } from "./appArtControlListeners";
import { registerAppCommandListeners } from "./appCommandListeners";
import { registerAppPointerListeners } from "./appPointerListeners";
import { registerAppSurfaceListeners } from "./appSurfaceListeners";
import type { BootProfile } from "./bootProfile";
import { installErrorDiagnostics } from "./errorDiagnostics";
import { registerExtensionLifecycle } from "./extensionLifecycle";
import { sanitizeHistoryState } from "./historyModel";
import { logger } from "./logger";
import { refreshLoomHookCapabilitiesOnStartup } from "./loomHookStartup";
import {
    restoredSessionNeedsCapabilityRefresh,
    sessionSnapshotNeedsCapabilityRefresh,
} from "./restoredSessionCapabilities";
import { pruneRecycleBinEntries } from "./stickerLibraryModel";
import { syncService } from "./syncService";
import { normalizeStickerToolSettings } from "./toolSettings";
import { loadCurrentAppSettings } from "./appSettings";
import { normalizeWorkflowSnapshotPayload } from "./workflowPayload";

type CommandListeners = Omit<Parameters<typeof registerAppCommandListeners>[0], "registry">;
type PointerListeners = Omit<Parameters<typeof registerAppPointerListeners>[0], "registry">;
type ArtControlListeners = Omit<Parameters<typeof registerAppArtControlListeners>[0], "registry">;
type SurfaceListeners = Omit<Parameters<typeof registerAppSurfaceListeners>[0], "registry">;

type AppStartupLifecycleDependencies = {
    tauriRuntime: boolean;
    setActiveBootProfile: (profile: BootProfile) => void;
    setVoiceSettings: Setter<VoiceSettingsSummary | null>;
    setAppSettings: Setter<AppSettings>;
    registerAppCommandListeners: CommandListeners;
    registerAppPointerListeners: PointerListeners;
    registerAppArtControlListeners: ArtControlListeners;
    registerAppSurfaceListeners: SurfaceListeners;
    handleGlobalMouseMove: (event: MouseEvent) => void;
    handleGlobalMouseUp: (event: MouseEvent) => void;
};

const loadStartupSettings = async ({
    tauriRuntime,
    setVoiceSettings,
    setAppSettings,
}: Pick<AppStartupLifecycleDependencies, "tauriRuntime" | "setVoiceSettings" | "setAppSettings">) => {
    try {
        const settings = await api.getVoiceSettingsSummary();
        setVoiceSettings(settings);
        if (tauriRuntime) {
            void api.debugLogEvent(
                "voice-settings-loaded",
                `shortcut=${settings.shortcut} trigger=${settings.triggerMode} audio=${settings.audioBackend} provider=${settings.providerKind} output=${settings.outputMode}`,
            );
        }
    } catch (error) {
        console.warn("Failed to load voice settings summary:", error);
        if (tauriRuntime) {
            void api.debugLogEvent(
                "voice-settings-failed",
                error instanceof Error ? error.message : String(error),
            );
        }
    }

    try {
        const toolSettingsData = await api.loadToolSettings();
        if (toolSettingsData?.stickerToolSettings) {
            uiActions.setStickerToolSettings(
                normalizeStickerToolSettings(toolSettingsData.stickerToolSettings as Record<string, unknown>),
            );
        }
    } catch (error) {
        console.warn("Failed to load sticker tool settings:", error);
    }

    try {
        setAppSettings(await loadCurrentAppSettings());
    } catch (error) {
        console.warn("Failed to load app settings:", error);
    }
};

const restoreStartupSession = async (
    bootProfile: BootProfile | null,
    refreshCapabilities: () => Promise<void>,
) => {
    let preloadedSession: Awaited<ReturnType<typeof api.loadSession>> | null = null;
    try {
        const preloadedSessionData = await api.loadSession();
        preloadedSession = preloadedSessionData;
        if (sessionSnapshotNeedsCapabilityRefresh(preloadedSessionData?.stickers, graphStore.capabilities)) {
            try {
                await refreshCapabilities();
            } catch (error) {
                console.warn("Failed to preflight restored-session art capabilities:", error);
            }
        }
    } catch (error) {
        console.warn("Failed to preflight persisted session before restore:", error);
    }

    await syncService.restoreSession(bootProfile || undefined, preloadedSession);
    const retainedRecycleEntries = pruneRecycleBinEntries(graphStore.recycleBin);
    if (retainedRecycleEntries.length !== graphStore.recycleBin.length) {
        graphStore.setRecycleBin(retainedRecycleEntries);
        await syncService.performWorkflowSync();
    }

    // Restored Art nodes need current catalog metadata before their second
    // materialization; otherwise they temporarily degrade into generic images.
    if (restoredSessionNeedsCapabilityRefresh(graphStore.units, graphStore.capabilities)) {
        try {
            await refreshCapabilities();
            await syncService.restoreSession(bootProfile || undefined);
        } catch (error) {
            console.warn("Failed to refresh restored-session art capabilities:", error);
        }
    }
    uiActions.retainUnitScopedState(new Set(graphStore.units.map((unit) => unit.id)));

    try {
        const rawHistory = await api.loadHistory();
        uiActions.setHistoryState(sanitizeHistoryState(rawHistory));
    } catch (error) {
        console.warn("Failed to load history; starting with empty history.", error);
    }
};

/** Owns the ordered, cancellation-safe initialization sequence for one App mount. */
export function useAppStartupLifecycle(dependencies: AppStartupLifecycleDependencies): void {
    onMount(async () => {
        logger.debug("App Mounted - Initializing...");
        const cleanups = new AppListenerRegistry();
        let bootProfile: BootProfile | null = null;

        // Establish ownership before the first await so a fast unmount also
        // disposes listeners whose asynchronous registration resolves later.
        onCleanup(() => {
            cleanups.dispose();
            surfaceResourceStore.actions.clearAll();
        });

        cleanups.push(installErrorDiagnostics(dependencies.tauriRuntime));
        if (dependencies.tauriRuntime) void api.debugLogEvent("frontend-mounted");

        try {
            bootProfile = await api.getBootProfile();
            dependencies.setActiveBootProfile(bootProfile);
            if (dependencies.tauriRuntime) {
                void api.debugLogEvent(
                    "boot-profile-loaded",
                    `startupMode=${bootProfile.startupMode} initialUiMode=${bootProfile.initialUiMode} autoStartCapture=${bootProfile.autoStartCapture} loomHookEnabled=${bootProfile.loomHookEnabled}`,
                );
            }
        } catch (error) {
            console.warn("Failed to load boot profile, falling back to defaults:", error);
            if (dependencies.tauriRuntime) {
                void api.debugLogEvent(
                    "boot-profile-failed",
                    error instanceof Error ? error.message : String(error),
                );
            }
        }

        await loadStartupSettings(dependencies);

        if (dependencies.tauriRuntime) {
            // Register before handshake/session restore so no initial workflow
            // broadcast can race ahead of the frontend listeners.
            await registerExtensionLifecycle(cleanups, dependencies.tauriRuntime);
            await registerAppCommandListeners({
                registry: cleanups,
                ...dependencies.registerAppCommandListeners,
            });
            await registerAppPointerListeners({
                registry: cleanups,
                ...dependencies.registerAppPointerListeners,
            });
            await registerAppArtControlListeners({
                registry: cleanups,
                ...dependencies.registerAppArtControlListeners,
            });
            await registerAppSurfaceListeners({
                registry: cleanups,
                ...dependencies.registerAppSurfaceListeners,
            });

            window.addEventListener("mousemove", dependencies.handleGlobalMouseMove);
            window.addEventListener("mouseup", dependencies.handleGlobalMouseUp);
            cleanups.push(() => {
                window.removeEventListener("mousemove", dependencies.handleGlobalMouseMove);
                window.removeEventListener("mouseup", dependencies.handleGlobalMouseUp);
            });
        }

        const refreshCapabilities = dependencies.registerAppArtControlListeners.refreshCapabilities;
        try {
            await refreshLoomHookCapabilitiesOnStartup(refreshCapabilities);
        } catch (error) {
            console.warn("Loom Hook bridge unavailable during startup; continuing in standalone mode.", error);
        }

        await restoreStartupSession(bootProfile, refreshCapabilities);

        if (bootProfile?.autoStartCapture) {
            await api.debugLogEvent("boot-autostart-capture");
            await api.triggerCaptureMode();
        }

        if (!dependencies.tauriRuntime) {
            logger.debug("Running in browser preview mode; attaching browser IPC listeners.");
            const stopInstantiate = listenBrowserLoomHookMethod(
                "loom.hook.workflow.instantiated",
                (payload) => {
                    dependencies.registerAppArtControlListeners
                        .instantiateWorkflowSnapshot(normalizeWorkflowSnapshotPayload(payload))
                        .catch((error) => console.error("Browser instantiate handler failed:", error));
                },
            );
            const stopCapabilitiesUpdated = listenBrowserLoomHookMethod(
                "loom.hook.capabilities.updated",
                async () => {
                    try {
                        await refreshCapabilities();
                    } catch (error) {
                        console.error("Failed to refresh browser preview capabilities:", error);
                    }
                },
            );
            cleanups.push(stopInstantiate, stopCapabilitiesUpdated);
            return;
        }

        await api.debugLogEvent(
            "frontend-initialized",
            `capabilities=${graphStore.capabilities.length} units=${graphStore.units.length}`,
        );
    });
}
