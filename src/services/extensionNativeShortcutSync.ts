import { safeInvoke } from "./apiTransport";
import type { NativeExtensionShortcut } from "./extensionShortcutRegistry";

/** Serializes native registrations so a stale snapshot cannot win a race. */
export class ExtensionNativeShortcutSync {
    private pending: Promise<void> = Promise.resolve();

    apply(enabled: boolean, shortcuts: NativeExtensionShortcut[]): void {
        if (!enabled) return;
        const snapshot = shortcuts.map((shortcut) => ({ ...shortcut }));
        this.pending = this.pending
            .catch(() => undefined)
            .then(() => safeInvoke<void>("set_extension_shortcuts", { shortcuts: snapshot }));
        void this.pending.catch((error) => {
            console.error("Failed to synchronize native extension shortcuts", error);
        });
    }
}

export const extensionNativeShortcutSync = new ExtensionNativeShortcutSync();
