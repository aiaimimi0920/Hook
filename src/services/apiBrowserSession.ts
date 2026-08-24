// Owns browser-preview session schema, revision checks, storage, and quota compaction.
import type { FrozenStickerEntry } from "./stickerSnapshot";
import type {
    SessionGroup,
    SessionLink,
    SessionSticker,
    WorkflowAssetArchiveIndex,
} from "../types/unit";
import {
    isBrowserPreviewSessionCandidate,
    isValidBrowserPreviewSessionRecord,
} from "./apiBrowserSessionValidation";

const BROWSER_SESSION_STORAGE_KEY = "hook_browser_preview_session";
const BROWSER_SESSION_DATA_URL_THRESHOLD = 8 * 1024;

interface BrowserPreviewSessionData {
    documentSchemaVersion: number;
    documentRevision: number;
    stickers: SessionSticker[];
    links: SessionLink[];
    groups?: SessionGroup[];
    recycleBin?: FrozenStickerEntry[];
    referenceLibrary?: FrozenStickerEntry[];
    workflowAssetArchiveIndex?: WorkflowAssetArchiveIndex;
}

interface BrowserPreviewSessionSaveResult {
    documentRevision: number;
}

export const loadBrowserPreviewSession = (): BrowserPreviewSessionData => {
    try {
        const raw = window.localStorage.getItem(BROWSER_SESSION_STORAGE_KEY);
        if (!raw) {
            return { documentSchemaVersion: 1, documentRevision: 0, stickers: [], links: [], groups: [], recycleBin: [], referenceLibrary: [] };
        }
        const parsed: unknown = JSON.parse(raw);
        if (isBrowserPreviewSessionCandidate(parsed)) {
            const hasSchema = parsed.documentSchemaVersion !== undefined;
            const hasRevision = parsed.documentRevision !== undefined;
            let documentRevision = 0;
            if (hasSchema) {
                if (
                    parsed.documentSchemaVersion !== 1
                    || typeof parsed.documentRevision !== "number"
                    || !Number.isSafeInteger(parsed.documentRevision)
                    || parsed.documentRevision < 0
                ) {
                    throw new Error(
                        `SESSION_SCHEMA_UNSUPPORTED browser session schema ${String(parsed.documentSchemaVersion)} is not supported`,
                    );
                }
                documentRevision = parsed.documentRevision;
            } else if (hasRevision) {
                throw new Error("SESSION_SCHEMA_INVALID documentRevision requires documentSchemaVersion");
            }
            if (!isValidBrowserPreviewSessionRecord(parsed)) {
                throw new Error(
                    "SESSION_SCHEMA_INVALID browser session contains malformed stickers, links, groups, archives, or frozen entries",
                );
            }
            return {
                documentSchemaVersion: 1,
                documentRevision,
                stickers: parsed.stickers,
                links: parsed.links,
                groups: parsed.groups ?? [],
                recycleBin: parsed.recycleBin ?? [],
                referenceLibrary: parsed.referenceLibrary ?? [],
                workflowAssetArchiveIndex: parsed.workflowAssetArchiveIndex,
            };
        }
    } catch (error) {
        if (String(error).includes("SESSION_SCHEMA_")) throw error;
        console.warn("[API] Failed to parse browser preview session:", error);
    }

    return { documentSchemaVersion: 1, documentRevision: 0, stickers: [], links: [], groups: [], recycleBin: [], referenceLibrary: [] };
};

const trimBrowserSessionValue = (
    value: string | null | undefined,
): string | null | undefined => {
    if (typeof value === "string" && value.startsWith("data:") && value.length > BROWSER_SESSION_DATA_URL_THRESHOLD) {
        return null;
    }
    return value;
};

const compactFrozenStickerEntry = (entry: FrozenStickerEntry): FrozenStickerEntry => ({
    ...entry,
    snapshot: {
        ...entry.snapshot,
        src: trimBrowserSessionValue(entry.snapshot.src) ?? "",
        previewSrc: trimBrowserSessionValue(entry.snapshot.previewSrc) ?? null,
        rasterizedAnnotationLayerSrc:
            trimBrowserSessionValue(entry.snapshot.rasterizedAnnotationLayerSrc) ?? null,
    },
});

const compactWorkflowAssetArchiveIndex = (
    index: WorkflowAssetArchiveIndex | undefined,
): WorkflowAssetArchiveIndex | undefined =>
    index
        ? {
            ...index,
            workflows: Object.fromEntries(
                Object.entries(index.workflows).map(([workflowId, workflow]) => [
                    workflowId,
                    {
                        ...workflow,
                        nodes: Object.fromEntries(
                            Object.entries(workflow.nodes).map(([nodeId, node]) => [
                                nodeId,
                                {
                                    ...node,
                                    src: trimBrowserSessionValue(node.src),
                                    previewSrc: trimBrowserSessionValue(node.previewSrc),
                                },
                            ]),
                        ),
                    },
                ]),
            ),
        }
        : undefined;

const compactBrowserPreviewSession = (
    stickers: SessionSticker[],
    links: SessionLink[],
    groups: SessionGroup[] = [],
    recycleBin: FrozenStickerEntry[] = [],
    referenceLibrary: FrozenStickerEntry[] = [],
    workflowAssetArchiveIndex?: WorkflowAssetArchiveIndex,
    documentRevision = 0,
): BrowserPreviewSessionData => ({
    documentSchemaVersion: 1,
    documentRevision,
    stickers: stickers.map((sticker) => ({
        ...sticker,
        src: trimBrowserSessionValue(sticker?.src),
        previewSrc: trimBrowserSessionValue(sticker?.previewSrc),
        rasterizedAnnotationLayerSrc: trimBrowserSessionValue(sticker?.rasterizedAnnotationLayerSrc),
    })),
    links,
    groups,
    recycleBin: recycleBin.map(compactFrozenStickerEntry),
    referenceLibrary: referenceLibrary.map(compactFrozenStickerEntry),
    workflowAssetArchiveIndex: compactWorkflowAssetArchiveIndex(workflowAssetArchiveIndex),
});

export const saveBrowserPreviewSession = (
    stickers: SessionSticker[],
    links: SessionLink[],
    groups: SessionGroup[] = [],
    recycleBin: FrozenStickerEntry[] = [],
    referenceLibrary: FrozenStickerEntry[] = [],
    workflowAssetArchiveIndex?: WorkflowAssetArchiveIndex,
    expectedDocumentRevision?: number,
): BrowserPreviewSessionSaveResult => {
    const current = loadBrowserPreviewSession();
    if (
        expectedDocumentRevision !== undefined
        && expectedDocumentRevision !== current.documentRevision
    ) {
        throw new Error(
            `SESSION_REVISION_CONFLICT expected ${expectedDocumentRevision}, current ${current.documentRevision}; refresh the Hook session before retrying`,
        );
    }
    const documentRevision = current.documentRevision + 1;
    try {
        window.localStorage.setItem(
            BROWSER_SESSION_STORAGE_KEY,
            JSON.stringify({
                documentSchemaVersion: 1,
                documentRevision,
                stickers,
                links,
                groups,
                recycleBin,
                referenceLibrary,
                workflowAssetArchiveIndex,
            }),
        );
    } catch {
        try {
            const compact = compactBrowserPreviewSession(
                stickers,
                links,
                groups,
                recycleBin,
                referenceLibrary,
                workflowAssetArchiveIndex,
                documentRevision,
            );
            window.localStorage.setItem(
                BROWSER_SESSION_STORAGE_KEY,
                JSON.stringify(compact),
            );
        } catch (compactError) {
            console.warn("[API] Failed to save browser preview session:", compactError);
            throw compactError;
        }
    }
    return { documentRevision };
};
