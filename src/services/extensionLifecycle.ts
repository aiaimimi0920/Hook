import { listen } from "@tauri-apps/api/event";

import type { AppListenerRegistry } from "./appListenerRegistry";
import { extensionBridgeClient } from "./extensionBridgeClient";
import { extensionCommandRouter } from "./extensionCommandRouter";
import { extensionNoticeRegistry } from "./extensionNoticeRegistry";
import { applyExtensionPresentationSnapshot } from "./extensionPresentationStore";
import { extensionRegistry } from "./extensionRegistry";
import { extensionShortcutRegistry } from "./extensionShortcutRegistry";

type NativeExtensionCommand = { commandId?: string; input?: unknown };

/** Owns all extension registrations so one disposer removes UI, shortcuts, and sessions. */
export const registerExtensionLifecycle = async (
    registry: AppListenerRegistry,
    tauriRuntime: boolean,
): Promise<void> => {
    const unsubscribe = extensionRegistry.subscribe((snapshot) => {
        extensionNoticeRegistry.applySnapshot(snapshot);
        applyExtensionPresentationSnapshot(snapshot);
        const rejected = extensionShortcutRegistry.applySnapshot(snapshot);
        if (rejected.length > 0) console.warn("Rejected conflicting extension shortcuts", rejected);
    });
    registry.push(() => {
        unsubscribe();
        applyExtensionPresentationSnapshot(null);
        extensionShortcutRegistry.applySnapshot(null);
    });

    window.addEventListener("keydown", extensionShortcutRegistry.handleKeyDown, true);
    registry.push(() => window.removeEventListener("keydown", extensionShortcutRegistry.handleKeyDown, true));
    registry.push(extensionBridgeClient.start());

    if (tauriRuntime) {
        await registry.register(() => listen<NativeExtensionCommand>("extension/command", (event) => {
            const commandId = event.payload?.commandId;
            if (!commandId) return;
            void extensionCommandRouter.execute(commandId, event.payload.input).catch((error) => {
                console.error(`Native extension command ${commandId} failed`, error);
            });
        }));
    }
};
