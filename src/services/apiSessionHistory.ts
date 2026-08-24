// Owns session and user-history command routing without owning storage resources.
import type { FrozenStickerEntry } from "./stickerSnapshot";
import type {
    SessionGroup,
    SessionLink,
    SessionSticker,
    WorkflowAssetArchiveHints,
} from "../types/unit";
import {
    loadBrowserPreviewSession,
    saveBrowserPreviewSession,
} from "./apiBrowserSession";
import { safeInvoke } from "./apiTransport";
import type { SessionData, SessionSaveResult } from "./apiTypes";

export const sessionHistoryApi = {
    loadSession: (): Promise<SessionData> =>
        safeInvoke("load_session", undefined, loadBrowserPreviewSession, false),

    saveSession: (
        stickers: SessionSticker[],
        links: SessionLink[],
        groups: SessionGroup[] = [],
        recycleBin: FrozenStickerEntry[] = [],
        referenceLibrary: FrozenStickerEntry[] = [],
        workflowAssetArchiveHints: WorkflowAssetArchiveHints = { workflows: {} },
        expectedDocumentRevision?: number,
    ): Promise<SessionSaveResult> =>
        safeInvoke(
            "save_session",
            {
                stickers,
                links,
                groups,
                recycleBin,
                referenceLibrary,
                workflowAssetArchiveHints,
                expectedDocumentRevision,
            },
            () =>
                saveBrowserPreviewSession(
                    stickers,
                    links,
                    groups,
                    recycleBin,
                    referenceLibrary,
                    // Archive hints describe backend file snapshots; browser preview has no such archive.
                    undefined,
                    expectedDocumentRevision,
                ),
            false,
        ),

    loadHistory: (): Promise<{ colors: unknown[]; screenshots: unknown[] }> =>
        safeInvoke("load_history", undefined, () => ({ colors: [], screenshots: [] }), false),

    saveHistory: (colors: unknown[], screenshots: unknown[]): Promise<void> =>
        safeInvoke("save_history", { colors, screenshots }, () => undefined, false),
};
