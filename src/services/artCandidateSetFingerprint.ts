import type { ArtResultCandidate } from "./protocol";

const CANDIDATE_STRING_FIELDS = [
    "title",
    "imageUrl",
    "thumbnail",
    "preview",
    "thumbnailUrl",
    "cachedImagePath",
    "cachedImageSrc",
    "cachedThumbnailPath",
    "cachedThumbnailSrc",
] as const satisfies readonly (keyof ArtResultCandidate)[];

/** Builds a bounded signature without duplicating potentially large data URLs. */
export const buildArtCandidateSetFingerprint = (
    candidates: readonly ArtResultCandidate[],
): string => {
    let fnv = 0x811c9dc5;
    let djb = 5381;
    let totalLength = 0;
    const mix = (value: string) => {
        totalLength += value.length;
        for (let index = 0; index < value.length; index += 1) {
            const code = value.charCodeAt(index);
            fnv = Math.imul(fnv ^ code, 0x01000193);
            djb = Math.imul(djb, 33) ^ code;
        }
        fnv = Math.imul(fnv ^ 0xffff, 0x01000193);
        djb = Math.imul(djb, 33) ^ 0xffff;
    };

    candidates.forEach((candidate) => {
        mix(String(candidate.index));
        CANDIDATE_STRING_FIELDS.forEach((field) => mix(candidate[field] || ""));
    });
    return `${candidates.length}:${totalLength}:${fnv >>> 0}:${djb >>> 0}`;
};
