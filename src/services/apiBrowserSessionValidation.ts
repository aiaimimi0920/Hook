// Validates the required shape of browser-preview session records before they reach stores.
import type { FrozenStickerEntry } from "./stickerSnapshot";
import type {
    SessionGroup,
    SessionLink,
    SessionSticker,
    WorkflowAssetArchiveIndex,
} from "../types/unit";

type UnknownRecord = Record<string, unknown>;

export type BrowserPreviewSessionCandidate = UnknownRecord & {
    stickers: unknown[];
    links: unknown[];
};

export interface ValidBrowserPreviewSessionRecord extends UnknownRecord {
    stickers: SessionSticker[];
    links: SessionLink[];
    groups?: SessionGroup[];
    recycleBin?: FrozenStickerEntry[];
    referenceLibrary?: FrozenStickerEntry[];
    workflowAssetArchiveIndex?: WorkflowAssetArchiveIndex;
}

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

const isOptionalString = (value: unknown): boolean =>
    value === undefined || value === null || typeof value === "string";

const isSessionSticker = (value: unknown): value is SessionSticker =>
    isRecord(value)
    && typeof value.id === "string"
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.w)
    && isFiniteNumber(value.h)
    && isOptionalString(value.src)
    && isOptionalString(value.previewSrc)
    && isOptionalString(value.filePath)
    && isOptionalString(value.rasterizedAnnotationLayerSrc);

const isSessionLink = (value: unknown): value is SessionLink =>
    isRecord(value)
    && typeof value.id === "string"
    && typeof value.fromUnitId === "string"
    && typeof value.fromPortId === "string"
    && typeof value.toUnitId === "string"
    && typeof value.toPortId === "string";

const isSessionGroup = (value: unknown): value is SessionGroup =>
    isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string";

const isFrozenStickerEntry = (value: unknown): value is FrozenStickerEntry => {
    if (
        !isRecord(value)
        || typeof value.entryId !== "string"
        || typeof value.sourceStickerId !== "string"
        || typeof value.createdAt !== "string"
        || !isRecord(value.snapshot)
    ) {
        return false;
    }
    const snapshot = value.snapshot;
    return typeof snapshot.id === "string"
        && typeof snapshot.src === "string"
        && isFiniteNumber(snapshot.x)
        && isFiniteNumber(snapshot.y)
        && isFiniteNumber(snapshot.w)
        && isFiniteNumber(snapshot.h)
        && typeof snapshot.minified === "boolean"
        && isFiniteNumber(snapshot.opacityNormal)
        && isFiniteNumber(snapshot.opacityMini)
        && isOptionalString(snapshot.previewSrc)
        && isOptionalString(snapshot.filePath)
        && isOptionalString(snapshot.rasterizedAnnotationLayerSrc);
};

const isWorkflowAssetArchiveIndex = (value: unknown): value is WorkflowAssetArchiveIndex => {
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.workflows)) return false;
    return Object.values(value.workflows).every((workflow) => {
        if (!isRecord(workflow) || typeof workflow.updatedAt !== "string" || !isRecord(workflow.nodes)) {
            return false;
        }
        return Object.values(workflow.nodes).every((node) =>
            isRecord(node)
            && typeof node.stickerId === "string"
            && typeof node.updatedAt === "string"
            && isOptionalString(node.src)
            && isOptionalString(node.previewSrc));
    });
};

const isOptionalArrayOf = <T>(
    value: unknown,
    predicate: (entry: unknown) => entry is T,
): value is T[] | undefined =>
    value === undefined || (Array.isArray(value) && value.every(predicate));

export const isBrowserPreviewSessionCandidate = (
    value: unknown,
): value is BrowserPreviewSessionCandidate =>
    isRecord(value) && Array.isArray(value.stickers) && Array.isArray(value.links);

export const isValidBrowserPreviewSessionRecord = (
    value: BrowserPreviewSessionCandidate,
): value is ValidBrowserPreviewSessionRecord =>
    value.stickers.every(isSessionSticker)
    && value.links.every(isSessionLink)
    && isOptionalArrayOf(value.groups, isSessionGroup)
    && isOptionalArrayOf(value.recycleBin, isFrozenStickerEntry)
    && isOptionalArrayOf(value.referenceLibrary, isFrozenStickerEntry)
    && (
        value.workflowAssetArchiveIndex === undefined
        || isWorkflowAssetArchiveIndex(value.workflowAssetArchiveIndex)
    );
