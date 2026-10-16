// Owns session and user-history command routing without owning storage resources.
import type { FrozenStickerEntry } from "../../features/stickers/services/stickerSnapshot";
import type {
    SessionGroup,
    SessionLink,
    SessionSticker,
    WorkflowAssetArchiveHints,
} from "../../features/workspace/types/unit";
import {
    loadBrowserPreviewSession,
    saveBrowserPreviewSession,
} from "./apiBrowserSession";
import { safeInvoke } from "./apiTransport";
import type { SessionData, SessionSaveResult } from "./apiTypes";
import { sessionAssetReferences } from "../../features/workspace/services/sessionAssetReferences";

export const sessionHistoryApi = {
    loadSession: (): Promise<SessionData> =>
        safeInvoke("load_session", undefined, loadBrowserPreviewSession),

    saveSession: (
        stickers: SessionSticker[],
        links: SessionLink[],
        groups: SessionGroup[] = [],
        recycleBin: FrozenStickerEntry[] = [],
        referenceLibrary: FrozenStickerEntry[] = [],
        workflowAssetArchiveHints: WorkflowAssetArchiveHints = { workflows: {} },
        expectedDocumentRevision?: number,
    ): Promise<SessionSaveResult> =>
        sessionAssetReferences.save(stickers, (persistedStickers, managedAssetPaths) => safeInvoke(
            "save_session",
            {
                stickers: persistedStickers,
                links,
                groups,
                recycleBin,
                referenceLibrary,
                workflowAssetArchiveHints,
                expectedDocumentRevision,
                managedAssetPaths,
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
        )),

    loadHistory: (): Promise<{ colors: unknown[]; screenshots: unknown[] }> =>
        safeInvoke("load_history", undefined, () => ({ colors: [], screenshots: [] })),

    saveHistory: (colors: unknown[], screenshots: unknown[]): Promise<void> =>
        safeInvoke("save_history", { colors, screenshots }, () => undefined),
};
