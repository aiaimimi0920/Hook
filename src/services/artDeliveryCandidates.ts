import type {
    ArtResultCandidate,
    ArtResultCandidateMetadata,
} from "./protocol";

export interface ArtDeliveryCandidateState {
    resultCandidates?: ArtResultCandidate[];
    selectedResultIndex?: number;
}

const normalizeOptionalNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const normalizeCandidate = (
    candidate: ArtResultCandidate | Record<string, unknown>,
): ArtResultCandidate | null => {
    const index = normalizeOptionalNumber(candidate.index);
    const imageUrl =
        typeof candidate.imageUrl === "string" ? candidate.imageUrl.trim() : "";
    if (index === undefined || imageUrl.length === 0) {
        return null;
    }

    const normalized: ArtResultCandidate = {
        index,
        imageUrl,
    };
    const stringFields = [
        "title",
        "thumbnail",
        "preview",
        "thumbnailUrl",
        "sourcePageUrl",
        "cachedImagePath",
        "cachedImageSrc",
        "cachedThumbnailPath",
        "cachedThumbnailSrc",
    ] as const;
    for (const field of stringFields) {
        const value = candidate[field];
        if (typeof value === "string" && value.trim().length > 0) {
            normalized[field] = value;
        }
    }
    const width = normalizeOptionalNumber(candidate.width);
    const height = normalizeOptionalNumber(candidate.height);
    if (width !== undefined) normalized.width = width;
    if (height !== undefined) normalized.height = height;
    return normalized;
};

const normalizeCandidateList = (value: unknown): ArtResultCandidate[] =>
    Array.isArray(value)
        ? value
              .map((candidate) => {
                  const record = asRecord(candidate);
                  return record ? normalizeCandidate(record) : null;
              })
              .filter((candidate): candidate is ArtResultCandidate => candidate !== null)
        : [];

const readGenericMetadata = (
    delivery: Record<string, unknown>,
): ArtResultCandidateMetadata | undefined => {
    const metadata = asRecord(delivery.candidates);
    if (!metadata) return undefined;
    const items = normalizeCandidateList(metadata.items);
    if (items.length === 0) return undefined;
    return {
        ...(typeof metadata.kind === "string" ? { kind: metadata.kind } : {}),
        items,
        ...(typeof metadata.selectedIndex === "number"
            ? { selectedIndex: Math.floor(metadata.selectedIndex) }
            : {}),
    };
};

const readLegacyMetadata = (
    delivery: Record<string, unknown>,
): ArtResultCandidateMetadata | undefined => {
    const imageSearch = asRecord(delivery.imageSearch);
    if (!imageSearch) return undefined;
    const items = normalizeCandidateList(imageSearch.candidates);
    if (items.length === 0) return undefined;
    return {
        kind: "image.candidates",
        items,
        ...(typeof imageSearch.selectedIndex === "number"
            ? { selectedIndex: Math.floor(imageSearch.selectedIndex) }
            : {}),
    };
};

export const extractArtDeliveryCandidatesState = (
    delivery: unknown,
): ArtDeliveryCandidateState => {
    const record = asRecord(delivery);
    if (!record) {
        return {
            resultCandidates: undefined,
            selectedResultIndex: undefined,
        };
    }

    const metadata = readGenericMetadata(record) || readLegacyMetadata(record);
    if (!metadata || metadata.items.length === 0) {
        return {
            resultCandidates: undefined,
            selectedResultIndex: undefined,
        };
    }

    const selectedResultIndex = metadata.items.some(
        (candidate) => candidate.index === metadata.selectedIndex,
    )
        ? metadata.selectedIndex
        : undefined;
    return {
        resultCandidates: metadata.items,
        selectedResultIndex,
    };
};
