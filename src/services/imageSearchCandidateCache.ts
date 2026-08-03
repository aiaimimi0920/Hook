import { api } from "./api";
import { mergeArtDeliveryOutputs } from "./artDeliveryOutputs";
import { normalizeImageSourceForDisplay } from "./imageSource";
import { logger } from "./logger";
import { syncService } from "./syncService";
import type { DeliveryImageSearchCandidate } from "./protocol";
import type { Unit } from "../types/unit";
import { graphStore } from "../store/graphStore";
import {
    isImageSearchPrefetchGenerationCurrent,
    nextImageSearchPrefetchGeneration,
    releaseImageSearchPrefetchGeneration,
} from "./imageSearchPrefetchGeneration";

type ImageSearchCandidateRuntimeFields = Pick<
    DeliveryImageSearchCandidate,
    "cachedImagePath" | "cachedImageSrc" | "cachedThumbnailPath" | "cachedThumbnailSrc"
>;

const IMAGE_SEARCH_RUNTIME_FIELDS: (keyof ImageSearchCandidateRuntimeFields)[] = [
    "cachedImagePath",
    "cachedImageSrc",
    "cachedThumbnailPath",
    "cachedThumbnailSrc",
];

const remoteImageDownloadsInFlight = new Map<string, Promise<string>>();

const candidateFullImageDisplaySrc = (candidate: DeliveryImageSearchCandidate) =>
    candidate.cachedImageSrc ||
    normalizeImageSourceForDisplay(candidate.cachedImagePath) ||
    normalizeImageSourceForDisplay(candidate.preview) ||
    normalizeImageSourceForDisplay(candidate.imageUrl) ||
    candidate.imageUrl;

const normalizeCandidatePreviewSrc = (src: string | null | undefined) =>
    normalizeImageSourceForDisplay(src) || src || undefined;

const pickImageSearchCandidateRuntimeFields = (
    candidate: DeliveryImageSearchCandidate | undefined,
): Partial<ImageSearchCandidateRuntimeFields> => {
    if (!candidate) return {};

    const nextFields: Partial<ImageSearchCandidateRuntimeFields> = {};
    IMAGE_SEARCH_RUNTIME_FIELDS.forEach((field) => {
        const value = candidate[field];
        if (typeof value === "string" && value.length > 0) {
            nextFields[field] = value;
        }
    });
    return nextFields;
};

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0;

const getImageSearchCandidateByIndex = (
    candidates: DeliveryImageSearchCandidate[] | undefined,
    candidateIndex: number,
) => candidates?.find((candidate) => candidate.index === candidateIndex);

const mergeImageSearchCandidatePatch = (
    candidates: DeliveryImageSearchCandidate[] | undefined,
    candidateIndex: number,
    patch: Partial<DeliveryImageSearchCandidate>,
) => {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return candidates;
    }

    let changed = false;
    const nextCandidates = candidates.map((candidate) => {
        if (candidate.index !== candidateIndex) {
            return candidate;
        }
        changed = true;
        return {
            ...candidate,
            ...patch,
        };
    });

    return changed ? nextCandidates : candidates;
};

const cacheRemoteImagePath = async (url: string, referer?: string) => {
    const normalizedUrl = url.trim();
    if (normalizedUrl.length === 0) {
        throw new Error("Remote image URL is required");
    }
    const normalizedReferer = referer?.trim() || "";
    const requestKey = `${normalizedUrl}\n${normalizedReferer}`;

    const existing = remoteImageDownloadsInFlight.get(requestKey);
    if (existing) {
        return existing;
    }

    const request = api
        .cacheRemoteImageAsset(normalizedUrl, normalizedReferer || undefined)
        .finally(() => remoteImageDownloadsInFlight.delete(requestKey));
    remoteImageDownloadsInFlight.set(requestKey, request);
    return request;
};

export const isRecoverableImageSearchExecutionFailure = (
    errorMessage: string | undefined,
    candidates: DeliveryImageSearchCandidate[] | undefined,
) =>
    Array.isArray(candidates) &&
    candidates.length > 0 &&
    typeof errorMessage === "string" &&
    errorMessage.includes("图片搜索已返回候选结果，但图片下载失败");

export const resolveImageSearchCandidateCardPreviewSrc = (
    candidate: DeliveryImageSearchCandidate,
    options?: {
        isSelected?: boolean;
        selectedPreviewSrc?: string;
    },
) =>
    normalizeCandidatePreviewSrc(candidate.cachedThumbnailSrc) ||
    normalizeCandidatePreviewSrc(candidate.cachedThumbnailPath) ||
    normalizeCandidatePreviewSrc(candidate.cachedImageSrc) ||
    normalizeCandidatePreviewSrc(candidate.cachedImagePath) ||
    (options?.isSelected
        ? normalizeCandidatePreviewSrc(options.selectedPreviewSrc)
        : undefined) ||
    normalizeCandidatePreviewSrc(candidate.preview) ||
    normalizeCandidatePreviewSrc(candidate.thumbnail) ||
    normalizeCandidatePreviewSrc(candidate.thumbnailUrl) ||
    normalizeCandidatePreviewSrc(candidate.imageUrl) ||
    candidate.preview ||
    candidate.thumbnail ||
    candidate.thumbnailUrl ||
    candidate.imageUrl;

export const orderImageSearchCandidatePrefetchQueue = (
    candidates: DeliveryImageSearchCandidate[] | undefined,
    selectedIndex?: number,
) => {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return [] as DeliveryImageSearchCandidate[];
    }

    const preferred =
        candidates.find((candidate) => candidate.index === selectedIndex) || candidates[0];
    return [
        preferred,
        ...candidates.filter((candidate) => candidate.index !== preferred.index),
    ];
};

export const mergeImageSearchCandidateRuntimeState = (
    previousCandidates: DeliveryImageSearchCandidate[] | undefined,
    nextCandidates: DeliveryImageSearchCandidate[] | undefined,
) => {
    if (!Array.isArray(nextCandidates) || nextCandidates.length === 0) {
        return undefined;
    }

    const previousByImageUrl = new Map(
        (previousCandidates || []).map((candidate) => [candidate.imageUrl, candidate]),
    );
    const previousByIndex = new Map(
        (previousCandidates || []).map((candidate) => [candidate.index, candidate]),
    );

    return nextCandidates.map((candidate) => {
        const previous =
            previousByImageUrl.get(candidate.imageUrl) ||
            previousByIndex.get(candidate.index);
        return {
            ...candidate,
            ...pickImageSearchCandidateRuntimeFields(previous),
        };
    });
};

export const buildOptimisticImageSearchSelectionPatch = (
    unit: Unit,
    candidate: DeliveryImageSearchCandidate,
): Partial<Unit["data"]> => {
    const previewSrc = candidateFullImageDisplaySrc(candidate);
    const filePath = isNonEmptyString(candidate.cachedImagePath)
        ? candidate.cachedImagePath
        : undefined;

    const nextOutputs = {
        ...(unit.data.outputs || {}),
    };
    if (previewSrc) {
        nextOutputs.output = previewSrc;
        nextOutputs.output_image = previewSrc;
    }
    if (filePath) {
        nextOutputs.file_path = filePath;
    } else {
        delete nextOutputs.file_path;
    }

    return {
        previewSrc,
        filePath,
        outputs: nextOutputs,
        selectedResultIndex: candidate.index,
    };
};

const updateCachedImageSearchCandidate = (
    unitId: string,
    candidateIndex: number,
    patch: Partial<DeliveryImageSearchCandidate>,
) => {
    const unit = graphStore.units.find((item) => item.id === unitId);
    if (!unit) return;

    const nextCandidates = mergeImageSearchCandidatePatch(
        unit.data.resultCandidates,
        candidateIndex,
        patch,
    );
    if (!nextCandidates || nextCandidates === unit.data.resultCandidates) {
        return;
    }

    const selectedCandidate = getImageSearchCandidateByIndex(
        nextCandidates,
        unit.data.selectedResultIndex ?? candidateIndex,
    );
    const selectedImageDisplay = selectedCandidate
        ? candidateFullImageDisplaySrc(selectedCandidate)
        : undefined;
    const selectedImagePath =
        selectedCandidate && isNonEmptyString(selectedCandidate.cachedImagePath)
            ? selectedCandidate.cachedImagePath
            : unit.data.filePath;
    const nextOutputs = mergeArtDeliveryOutputs({
        currentOutputs: unit.data.outputs,
        previewSrc: selectedImageDisplay,
        filePath: selectedImagePath,
    });
    const recoveredFromImageSearchFailure =
        unit.data.imageSearchRecoveryPending === true &&
        selectedCandidate?.index === unit.data.selectedResultIndex &&
        isNonEmptyString(selectedCandidate?.cachedImagePath);

    graphStore.actions.updateUnitData(unitId, {
        resultCandidates: nextCandidates,
        ...(selectedImageDisplay &&
        selectedCandidate?.index === unit.data.selectedResultIndex
            ? {
                  previewSrc: selectedImageDisplay,
                  filePath: selectedImagePath,
                  outputs: nextOutputs,
                  ...(recoveredFromImageSearchFailure
                      ? {
                            nodeStatus: "completed",
                            errorMessage: undefined,
                            imageSearchRecoveryPending: false,
                            processing: false,
                            progress: 1,
                        }
                      : {}),
              }
            : {}),
    });
    void syncService.performWorkflowSync();
};

const prefetchSingleCandidate = async (
    unitId: string,
    candidate: DeliveryImageSearchCandidate,
    generation: number,
) => {
    const liveCandidateBeforeThumb = getImageSearchCandidateByIndex(
        graphStore.units.find((item) => item.id === unitId)?.data.resultCandidates,
        candidate.index,
    );
    const thumbnailUrl =
        liveCandidateBeforeThumb?.thumbnailUrl ||
        liveCandidateBeforeThumb?.thumbnail ||
        candidate.thumbnailUrl ||
        candidate.thumbnail;
    const referer = liveCandidateBeforeThumb?.sourcePageUrl || candidate.sourcePageUrl;
    if (
        isImageSearchPrefetchGenerationCurrent(unitId, generation) &&
        isNonEmptyString(thumbnailUrl) &&
        !isNonEmptyString(liveCandidateBeforeThumb?.cachedThumbnailPath) &&
        !isNonEmptyString(liveCandidateBeforeThumb?.cachedThumbnailSrc)
    ) {
        try {
            const cachedThumbnailPath = await cacheRemoteImagePath(
                thumbnailUrl,
                referer,
            );
            if (!isImageSearchPrefetchGenerationCurrent(unitId, generation)) return;
            updateCachedImageSearchCandidate(unitId, candidate.index, {
                cachedThumbnailPath,
                cachedThumbnailSrc:
                    normalizeImageSourceForDisplay(cachedThumbnailPath) || cachedThumbnailPath,
            });
        } catch (error) {
            logger.warn("Image-search thumbnail cache failed", candidate.index, error);
        }
    }

    const liveCandidateBeforeImage = getImageSearchCandidateByIndex(
        graphStore.units.find((item) => item.id === unitId)?.data.resultCandidates,
        candidate.index,
    );
    if (
        !isImageSearchPrefetchGenerationCurrent(unitId, generation) ||
        !liveCandidateBeforeImage ||
        isNonEmptyString(liveCandidateBeforeImage.cachedImagePath) ||
        isNonEmptyString(liveCandidateBeforeImage.cachedImageSrc)
    ) {
        return;
    }

    try {
        const cachedImagePath = await cacheRemoteImagePath(
            liveCandidateBeforeImage.imageUrl,
            referer,
        );
        if (!isImageSearchPrefetchGenerationCurrent(unitId, generation)) return;
        updateCachedImageSearchCandidate(unitId, candidate.index, {
            cachedImagePath,
            cachedImageSrc:
                normalizeImageSourceForDisplay(cachedImagePath) || cachedImagePath,
        });
    } catch (error) {
        logger.warn("Image-search candidate cache failed", candidate.index, error);
    }
};

export const prefetchImageSearchCandidateAssets = async (input: {
    unitId: string;
    candidates: DeliveryImageSearchCandidate[] | undefined;
    selectedIndex?: number;
}) => {
    const generation = nextImageSearchPrefetchGeneration(input.unitId);
    const orderedCandidates = orderImageSearchCandidatePrefetchQueue(
        input.candidates,
        input.selectedIndex,
    );
    try {
        for (const candidate of orderedCandidates) {
            if (!isImageSearchPrefetchGenerationCurrent(input.unitId, generation)) {
                return;
            }
            await prefetchSingleCandidate(input.unitId, candidate, generation);
        }
    } finally {
        releaseImageSearchPrefetchGeneration(input.unitId, generation);
    }
};
