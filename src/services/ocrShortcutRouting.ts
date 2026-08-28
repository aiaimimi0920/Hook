import {
    ocrInteractiveUnitId,
    selectedStickerId,
    uiActions,
} from "../store/uiStore";

interface StickerToolbarShortcutOptions {
    fallback: () => void;
    refreshHitTest: () => void;
}

const OCR_SHORTCUT_DEDUP_MS = 250;
let lastOcrShortcutAt = Number.NEGATIVE_INFINITY;

const shouldHandleOcrShortcut = () => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastOcrShortcutAt < OCR_SHORTCUT_DEDUP_MS) return false;
    lastOcrShortcutAt = now;
    return true;
};

/** Keeps native and focused-WebView Ctrl+E events on one toolbar-only route. */
export const toggleSelectedStickerToolbar = ({
    fallback,
    refreshHitTest,
}: StickerToolbarShortcutOptions): void => {
    // Tauri's global-shortcut event and the focused WebView keydown can carry
    // the same Ctrl+E press. One owner must toggle the state, not both.
    if (!shouldHandleOcrShortcut()) return;
    fallback();
    // OCR blocks become interactive through Ctrl+2/Alt+2 and remain so while
    // the toolbar opens. Ctrl+E must not require a second press or hide them.
    refreshHitTest();
};

export const clearOcrInteractionIfSelectionChanged = (): void => {
    const interactiveUnitId = ocrInteractiveUnitId();
    if (interactiveUnitId && interactiveUnitId !== selectedStickerId()) {
        uiActions.clearOcrInteractiveUnit(interactiveUnitId);
    }
};
