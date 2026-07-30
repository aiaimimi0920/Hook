import type {
    DeliveryImageSearchCandidate,
} from "./protocol";

export interface ArtDeliveryImageSearchState {
    resultCandidates?: DeliveryImageSearchCandidate[];
    selectedResultIndex?: number;
}

const normalizeOptionalNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;

const normalizeCandidate = (
    candidate: DeliveryImageSearchCandidate | Record<string, unknown>,
): DeliveryImageSearchCandidate | null => {
    const index = normalizeOptionalNumber(candidate.index);
    const imageUrl =
        typeof candidate.imageUrl === "string" ? candidate.imageUrl.trim() : "";
    if (index === undefined || imageUrl.length === 0) {
        return null;
    }

    const normalized: DeliveryImageSearchCandidate = {
        index,
        imageUrl,
    };
    if (typeof candidate.title === "string" && candidate.title.trim().length > 0) {
        normalized.title = candidate.title;
    }
    if (
        typeof candidate.thumbnailUrl === "string" &&
        candidate.thumbnailUrl.trim().length > 0
    ) {
        normalized.thumbnailUrl = candidate.thumbnailUrl;
    }
    if (
        typeof candidate.sourcePageUrl === "string" &&
        candidate.sourcePageUrl.trim().length > 0
    ) {
        normalized.sourcePageUrl = candidate.sourcePageUrl;
    }
    const width = normalizeOptionalNumber(candidate.width);
    const height = normalizeOptionalNumber(candidate.height);
    if (width !== undefined) normalized.width = width;
    if (height !== undefined) normalized.height = height;
    return normalized;
};

export const extractArtDeliveryImageSearchState = (
    delivery: { imageSearch?: { candidates?: unknown; selectedIndex?: unknown } },
): ArtDeliveryImageSearchState => {
    const rawCandidates = Array.isArray(delivery.imageSearch?.candidates)
        ? delivery.imageSearch?.candidates
        : [];
    const resultCandidates = rawCandidates
        .map((candidate) => normalizeCandidate(candidate))
        .filter((candidate): candidate is DeliveryImageSearchCandidate => candidate !== null);

    if (resultCandidates.length === 0) {
        return {
            resultCandidates: undefined,
            selectedResultIndex: undefined,
        };
    }

    const selected = normalizeOptionalNumber(delivery.imageSearch?.selectedIndex);
    const selectedResultIndex = resultCandidates.some(
        (candidate) => candidate.index === selected,
    )
        ? selected
        : undefined;

    return {
        resultCandidates,
        selectedResultIndex,
    };
};
