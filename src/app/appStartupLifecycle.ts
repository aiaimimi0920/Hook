import { onCleanup, onMount, type Setter } from "solid-js";

import { graphStore } from "../features/workspace/state/graphStore";
import { surfaceResourceStore } from "../features/surfaces/state/surfaceResourceStore";
import { uiActions } from "../features/workspace/state/uiStore";
import type { AppSettings } from "../features/settings/types/appSettings";
import { api, listenBrowserLoomOtterMethod, type VoiceSettingsSummary } from "../platform/tauri/api";
import { AppListenerRegistry } from "./appListenerRegistry";
import { setStartupSessionReady } from "./appStartupState";
import { registerAppArtControlListeners } from "./appArtControlListeners";
import { registerAppCommandListeners } from "./appCommandListeners";
import { registerAppPointerListeners } from "./appPointerListeners";
import { registerAppSurfaceListeners } from "./appSurfaceListeners";
import type { BootProfile } from "../features/settings/services/bootProfile";
import { installErrorDiagnostics } from "../platform/desktop/errorDiagnostics";
import { registerExtensionLifecycle } from "../features/extensions/services/extensionLifecycle";
import { sanitizeHistoryState } from "../features/workspace/services/historyModel";
import { logger } from "../shared/diagnostics/logger";
import { refreshLoomOtterCapabilitiesOnStartup } from "../integrations/loom/loomOtterStartup";
import {
    restoredSessionNeedsCapabilityRefresh,
    sessionSnapshotNeedsCapabilityRefresh,
} from "../features/workspace/services/restoredSessionCapabilities";
import { pruneRecycleBinEntries } from "../features/stickers/services/stickerLibraryModel";
import { syncService } from "../features/workspace/services/syncService";
import { normalizeStickerToolSettings } from "../features/settings/services/toolSettings";
import { loadCurrentAppSettings } from "../features/settings/services/appSettings";
import { normalizeWorkflowSnapshotPayload } from "../features/workspace/services/workflowPayload";

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
        if (bootProfile?.loomOtterEnabled === true && sessionSnapshotNeedsCapabilityRefresh(preloadedSessionData?.stickers, graphStore.capabilities)) {
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
    if (bootProfile?.loomOtterEnabled === true && restoredSessionNeedsCapabilityRefresh(graphStore.units, graphStore.capabilities)) {
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
        setStartupSessionReady(false);
        let bootProfile: BootProfile | null = null;

        // Establish ownership before the first await so a fast unmount also
        // disposes listeners whose asynchronous registration resolves later.
        onCleanup(() => {
            cleanups.dispose();
            setStartupSessionReady(false);
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
                    `startupMode=${bootProfile.startupMode} initialUiMode=${bootProfile.initialUiMode} autoStartCapture=${bootProfile.autoStartCapture} loomOtterEnabled=${bootProfile.loomOtterEnabled}`,
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
            if (bootProfile?.loomOtterEnabled === true) {
                await registerExtensionLifecycle(cleanups, dependencies.tauriRuntime);
            }
            await registerAppCommandListeners({
                registry: cleanups,
                ...dependencies.registerAppCommandListeners,
            });
            await registerAppPointerListeners({
                registry: cleanups,
                ...dependencies.registerAppPointerListeners,
            });
            if (bootProfile?.loomOtterEnabled === true) {
                await registerAppArtControlListeners({
                    registry: cleanups,
                    ...dependencies.registerAppArtControlListeners,
                });
            }
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
            await refreshLoomOtterCapabilitiesOnStartup(refreshCapabilities, bootProfile?.loomOtterEnabled === true);
        } catch (error) {
            console.warn("Loom Otter bridge unavailable during startup; continuing in standalone mode.", error);
        }

        await restoreStartupSession(bootProfile, refreshCapabilities);
        if (!cleanups.isDisposed) setStartupSessionReady(true);

        if (bootProfile?.autoStartCapture) {
            await api.debugLogEvent("boot-autostart-capture");
            await api.triggerCaptureMode();
        }

        if (!dependencies.tauriRuntime) {
            logger.debug("Running in browser preview mode; attaching browser IPC listeners.");
            const stopInstantiate = listenBrowserLoomOtterMethod(
                "loom.hook.workflow.instantiated",
                (payload) => {
                    dependencies.registerAppArtControlListeners
                        .instantiateWorkflowSnapshot(normalizeWorkflowSnapshotPayload(payload))
                        .catch((error) => console.error("Browser instantiate handler failed:", error));
                },
            );
            const stopCapabilitiesUpdated = listenBrowserLoomOtterMethod(
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
