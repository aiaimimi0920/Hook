interface StickerToolbarShortcutOptions {
    fallback: () => void | Promise<void>;
    refreshHitTest: () => void;
}

const SHORTCUT_DEDUP_MS = 250;
let lastShortcutAt = Number.NEGATIVE_INFINITY;

const shouldHandleShortcut = () => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastShortcutAt < SHORTCUT_DEDUP_MS) return false;
    lastShortcutAt = now;
    return true;
};

/** Keeps native and focused-WebView Ctrl+E events on one toolbar-only route. */
export const toggleSelectedStickerToolbar = ({
    fallback,
    refreshHitTest,
}: StickerToolbarShortcutOptions): void => {
    if (!shouldHandleShortcut()) return;
    const pending = fallback();
    if (pending) void pending.then(refreshHitTest).catch(() => undefined);
    else refreshHitTest();
};
