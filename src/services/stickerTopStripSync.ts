import { syncService } from "./syncService";

const reportBackgroundFailure = (operation: string, promise: Promise<unknown>) => {
    void promise.catch((error) => {
        console.error(`[Hook] ${operation}`, error);
    });
};

/** Syncs a locally committed sticker edit without creating an unhandled rejection. */
export const syncStickerEditAfterLocalCommit = () => {
    reportBackgroundFailure(
        "Failed to sync a committed sticker edit",
        syncService.performWorkflowSync(),
    );
};

/** Publishes current top-strip rectangles without leaking a rejected cleanup promise. */
export const syncTopStripBackendRects = () => {
    reportBackgroundFailure("Failed to sync top-strip rectangles", syncService.updateBackendRects());
};
